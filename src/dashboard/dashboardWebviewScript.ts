/** Dashboard Webview — ブラウザ側スクリプト (HTML に埋め込む文字列) */
export const dashboardWebviewScript = String.raw`
'use strict';
const vscode = acquireVsCodeApi();
const STRINGS = window.STRINGS;

// DashboardState が唯一の永続的な UI source of truth。以下は表示用の一時状態だけを保持する。
let state = null;
let requestCounter = 0;
let searchQuery = '';
let searchTimer = null;
let ticketDetailExpanded = false;
let activeTicketActionMenuId = null;
let activeTicketActionAnchorTop = null;
let newTicketPopoverAnchor = null;
let composerDraftKey = null;
let composerDraftValues = null;
const expandedTicketIds = new Set();
const collapsedTicketIds = new Set();
const activeSyncRequests = new Set();
const unsyncedFeedbackRequests = new Set();
const COMPOSER_POPOVER_MARGIN = 8;

function esc(value){ return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function send(message){ vscode.postMessage(message); }
function req(type, extra){ const requestId='req-'+(++requestCounter); if(type === 'unsynced.syncOne' || type === 'unsynced.syncAll') unsyncedFeedbackRequests.add(requestId); send(Object.assign({type:type,requestId:requestId}, extra || {})); }
function isElement(value){ return !!value && typeof value.closest === 'function'; }
function clamp(value, min, max){ return Math.min(Math.max(value, min), max); }
function safeJson(value){ try { return esc(JSON.stringify(value)); } catch { return ''; } }

// DOM 更新後も同じコントロールへ戻す。入力値や選択位置はフォーム側で保持する。
function captureFocus(root){
  const element=document.activeElement;
  if(!element || !root.contains(element)) return null;
  let selector=element.id ? '#'+CSS.escape(element.id) : null;
  if(!selector){
    const attributes=['data-ticket-action-menu','data-ticket-action','data-expand','data-metadata-field','data-id'];
    const attribute=attributes.find(function(name){ return element.hasAttribute(name); });
    if(attribute) selector='['+attribute+'="'+CSS.escape(element.getAttribute(attribute))+'"]';
    const row=element.closest('.ticket-row');
    if(row && attribute !== 'data-id') selector='.ticket-row[data-id="'+row.dataset.id+'"] '+selector;
  }
  return selector ? {selector:selector,start:element.selectionStart,end:element.selectionEnd} : null;
}
function restoreFocus(focus){
  if(!focus) return;
  const element=document.querySelector(focus.selector);
  if(!element || element.disabled || element.closest('[hidden],.hidden')) return;
  element.focus({preventScroll:true});
  if(typeof focus.start === 'number' && typeof element.setSelectionRange === 'function') element.setSelectionRange(focus.start,focus.end);
}
function flattenAll(nodes){
  return (nodes || []).flatMap(function(node){ return [node].concat(flattenAll(node.children)); });
}

// ── Operation feedback ────────────────────────────────────────────────────
function setOperationFeedback(level, message){
  const area = document.getElementById('unsynced-feedback');
  if(!area) return;
  area.className = 'operation-feedback ' + level;
  area.textContent = message || '';
  area.classList.toggle('hidden', !message);
}
function showToast(level, message){
  const area = document.getElementById('toast-area');
  if(!area) return;
  const item = document.createElement('div');
  item.className = 'toast toast-' + level;
  item.setAttribute('role','status');
  item.textContent = message || '';
  area.appendChild(item);
  window.setTimeout(function(){ item.classList.add('toast-fade'); }, 3200);
  window.setTimeout(function(){ if(item.parentNode) item.parentNode.removeChild(item); }, 4000);
}
function updateSyncButtonStates(){
  const busy = activeSyncRequests.size > 0;
  document.querySelectorAll('[data-sync-key],[data-discard-key],[data-sync-comment-key]').forEach(function(button){ button.disabled = busy; });
  const syncAll = document.getElementById('sync-all-btn');
  if(syncAll){ syncAll.disabled = busy; syncAll.setAttribute('aria-busy', String(busy)); }
}
function startOperation(requestId, label){
  activeSyncRequests.add(requestId);
  if(unsyncedFeedbackRequests.has(requestId)) setOperationFeedback('info', label || STRINGS.syncSyncing);
  updateSyncButtonStates();
}
function endOperation(requestId){ activeSyncRequests.delete(requestId); updateSyncButtonStates(); }
function finishOperation(level, requestId, message){ if(unsyncedFeedbackRequests.delete(requestId)) setOperationFeedback(level, message); }

// ── Tabs ───────────────────────────────────────────────────────────────────
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
function activateTab(name){
  tabs.forEach(function(tab){
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });
  panels.forEach(function(panel){
    const active = panel.id === 'panel-' + name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}
tabs.forEach(function(tab){ tab.addEventListener('click', function(){ activateTab(tab.dataset.tab); }); });
document.getElementById('tabs').addEventListener('keydown', function(event){
  const current = tabs.findIndex(function(tab){ return tab.getAttribute('aria-selected') === 'true'; });
  let next = -1;
  if(event.key === 'ArrowRight') next = (current + 1) % tabs.length;
  if(event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
  if(event.key === 'Home') next = 0;
  if(event.key === 'End') next = tabs.length - 1;
  if(next >= 0){ activateTab(tabs[next].dataset.tab); tabs[next].focus(); event.preventDefault(); }
});

// ── Header / search ───────────────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', function(){ req('dashboard.refresh'); });
document.getElementById('new-ticket-btn').addEventListener('click', function(){ activateTab('tickets'); measureNewTicketPopoverAnchor(); req('ticket.create'); });
document.getElementById('include-children').addEventListener('change', function(){ req('project.toggleChildren',{includeChildProjects:this.checked}); });
document.getElementById('project-select').addEventListener('change', function(){ if(this.value) req('project.select',{projectId:Number(this.value)}); });
const searchInput = document.getElementById('search-input');
const searchClearButton = document.getElementById('search-clear-btn');
function updateSearchClearButton(){ searchClearButton.classList.toggle('hidden', !searchInput.value); }
function clearSearch(){
  searchInput.value = '';
  searchQuery = '';
  if(searchTimer){ window.clearTimeout(searchTimer); searchTimer = null; }
  updateSearchClearButton();
  if(!state || !state.selectedProject) req('tickets.searchAllProjects',{query:''}); else renderTickets();
  searchInput.focus();
}
searchInput.addEventListener('input', function(){
  searchQuery = this.value.toLowerCase();
  updateSearchClearButton();
  if(!state || !state.selectedProject){
    if(searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function(){ searchTimer = null; req('tickets.searchAllProjects',{query:searchInput.value}); }, 300);
  } else renderTickets();
});
searchClearButton.addEventListener('click', clearSearch);
searchInput.addEventListener('keydown', function(event){ if(event.key === 'Escape' && this.value){ clearSearch(); event.preventDefault(); } });

// ── Display helpers ───────────────────────────────────────────────────────
const SYNC_META = {
  Dirty: {label:STRINGS.syncDirty, badge:'sync-dirty', icon:'•'},
  Queued: {label:STRINGS.syncQueued, badge:'sync-queued', icon:'→'},
  Conflict: {label:STRINGS.syncConflict, badge:'sync-conflict', icon:'△'},
  Failed: {label:STRINGS.syncFailed, badge:'sync-failed', icon:'×'},
  Syncing: {label:STRINGS.syncSyncing, badge:'sync-syncing', icon:'↻'},
};
function syncLabel(value){ return SYNC_META[value] ? SYNC_META[value].label : value === 'Synced' ? STRINGS.synced : value === 'Draft' ? STRINGS.draft : String(value || ''); }
function syncBadgeClass(value){ return SYNC_META[value] ? SYNC_META[value].badge : ''; }
function badge(label, className, icon){
  return '<span class="badge '+(className || '')+'"><span class="badge-icon" aria-hidden="true">'+esc(icon || '•')+'</span><span>'+esc(label)+'</span></span>';
}
function syncBadge(value){
  const meta = SYNC_META[value];
  return meta ? badge(meta.label, meta.badge, meta.icon) : '';
}
function initials(name){
  const value = String(name || '').trim();
  if(!value) return '?';
  const chars = Array.from(value.replace(/\s+/g,''));
  return chars.slice(0,2).join('').toUpperCase();
}
function hasAssignee(name){ return String(name || '').trim() !== ''; }
function avatar(name, className){
  const label = name || STRINGS.assigneeUnassigned;
  return '<span class="avatar '+(className || '')+'" role="img" aria-label="'+esc(label)+'">'+esc(initials(name))+'</span>';
}
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
function daysUntilDateOnly(value, now){
  const match = DATE_ONLY_PATTERN.exec(String(value || ''));
  if(!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = Date.UTC(year,month - 1,day);
  const targetDate = new Date(target);
  if(targetDate.getUTCFullYear() !== year || targetDate.getUTCMonth() !== month - 1 || targetDate.getUTCDate() !== day) return undefined;
  const current = now || new Date();
  const today = Date.UTC(current.getFullYear(),current.getMonth(),current.getDate());
  return Math.round((target - today) / DAY_MS);
}
function resolveDueDateBadge(dueDate, rule, now){
  if(!dueDate || !rule) return null;
  const difference = daysUntilDateOnly(dueDate, now);
  if(difference === undefined) return null;
  if(difference < 0 && rule.showOverdue) return {label:STRINGS.dueOverdue,cls:'due-overdue',icon:'!'};
  if(difference >= 0 && difference <= 1 && rule.showWithin1Day) return {label:STRINGS.due1Day,cls:'due-1day',icon:'!'};
  if(difference >= 0 && difference <= 3 && rule.showWithin3Days) return {label:STRINGS.due3Days,cls:'due-3days',icon:'•'};
  if(difference >= 0 && difference <= 7 && rule.showWithin7Days) return {label:STRINGS.due7Days,cls:'due-7days',icon:'•'};
  return null;
}
function dueBadge(ticket){
  const showDueDate = state.settings && state.settings.showDueDate !== false;
  if(!showDueDate) return '';
  const data = resolveDueDateBadge(ticket.dueDate, state.settings.dueDate);
  return data ? badge(data.label,data.cls,data.icon) : '';
}
function findTicket(nodes, ticketId){
  for(const node of nodes || []){ if(node.id === ticketId) return node; const nested = findTicket(node.children,ticketId); if(nested) return nested; }
  return null;
}
function flattenVisible(nodes, result){
  const output = result || [];
  for(const node of nodes || []){ output.push(node); if(node.children && node.children.length && expandedTicketIds.has(node.id)) flattenVisible(node.children,output); }
  return output;
}
function syncExpandedState(nodes){
  for(const node of nodes || []){ if(node.children && node.children.length && !collapsedTicketIds.has(node.id)) expandedTicketIds.add(node.id); syncExpandedState(node.children); }
}
function matchesSearch(ticket){ return !searchQuery || String(ticket.id).indexOf(searchQuery) >= 0 || String(ticket.subject || '').toLowerCase().indexOf(searchQuery) >= 0; }

// ── Ticket list ───────────────────────────────────────────────────────────
function closeTicketActionMenus(){
  const activeMenu=activeTicketActionMenuId && document.getElementById(activeTicketActionMenuId);
  if(activeMenu && activeMenu.contains(document.activeElement)) document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]')?.focus();
  document.querySelectorAll('.ticket-action-menu').forEach(function(menu){ menu.classList.add('hidden'); });
  document.querySelectorAll('.ticket-action-btn[aria-expanded="true"]').forEach(function(button){ button.setAttribute('aria-expanded','false'); });
  activeTicketActionMenuId = null;
  activeTicketActionAnchorTop = null;
}
function toggleTicketActionMenu(ticketId){
  const id = 'ticket-action-menu-' + ticketId;
  const open = activeTicketActionMenuId !== id;
  closeTicketActionMenus();
  if(!open) return;
  const menu = document.getElementById(id);
  const button = document.querySelector('[data-ticket-action-menu="'+ticketId+'"]');
  if(menu){ menu.classList.remove('hidden'); menu.querySelector('[role="menuitem"]')?.focus(); }
  if(button) button.setAttribute('aria-expanded','true');
  activeTicketActionMenuId = id;
  if(menu){
    const rect=button.getBoundingClientRect();
    activeTicketActionAnchorTop=rect.top;
    const bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.right-bounds.width,window.innerWidth-bounds.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-bounds.height-8))+'px';
  }
}
function runTicketAction(action,ticketId){
  closeTicketActionMenus();
  if(action === 'open') req('ticket.openEditor',{ticketId:ticketId});
  else if(action === 'comment') req('comment.add',{ticketId:ticketId});
  else if(action === 'browser') req('ticket.openBrowser',{ticketId:ticketId});
  else if(action === 'child') req('ticket.createChild',{parentTicketId:ticketId});
}
document.addEventListener('click', function(event){ if(!isElement(event.target) || !event.target.closest('.ticket-action-menu,.ticket-action-btn')) closeTicketActionMenus(); });
document.addEventListener('keydown', function(event){
  if(!activeTicketActionMenuId) return;
  const menu=document.getElementById(activeTicketActionMenuId);
  const trigger=document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]');
  if(event.key === 'Escape'){ closeTicketActionMenus(); trigger?.focus(); event.preventDefault(); return; }
  if(!menu || !menu.contains(event.target)) return;
  const items=Array.from(menu.querySelectorAll('[role="menuitem"]'));
  const current=items.indexOf(document.activeElement);
  let next=-1;
  if(event.key === 'ArrowDown') next=(current+1)%items.length;
  if(event.key === 'ArrowUp') next=(current-1+items.length)%items.length;
  if(event.key === 'Home') next=0;
  if(event.key === 'End') next=items.length-1;
  if(next >= 0){ items[next].focus(); event.preventDefault(); }
});
document.addEventListener('focusin', function(event){
  if(activeTicketActionMenuId && isElement(event.target) && !event.target.closest('.ticket-actions')) closeTicketActionMenus();
});
document.addEventListener('scroll',function(event){
  if(!activeTicketActionMenuId || (isElement(event.target) && event.target.closest('.ticket-action-menu'))) return;
  const trigger=document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]');
  if(!trigger || trigger.getBoundingClientRect().top !== activeTicketActionAnchorTop) closeTicketActionMenus();
},true);
function renderTicketRow(ticket){
  const selected = ticket.id === state.selectedTicketId;
  const hasChildren = !!(ticket.children && ticket.children.length);
  const expanded = expandedTicketIds.has(ticket.id);
  const sync = ticket.syncState && ticket.syncState !== 'Synced' && ticket.syncState !== 'Draft' ? syncBadge(ticket.syncState) : '';
  const status = state.settings && state.settings.showStatus !== false && ticket.statusName ? badge(ticket.statusName,'ticket-status','•') : '';
  const due = dueBadge(ticket);
  const actionItems = [['open',STRINGS.openInEditor],['comment',STRINGS.addCommentAction],['browser',STRINGS.openInBrowser],['child',STRINGS.createChildTicket]].map(function(item){ return '<button type="button" role="menuitem" data-ticket-action="'+item[0]+'" data-ticket="'+ticket.id+'">'+esc(item[1])+'</button>'; }).join('');
  const actionMenu = '<span class="ticket-actions"><button class="ticket-action-btn" type="button" data-ticket-action-menu="'+ticket.id+'" aria-haspopup="menu" aria-expanded="false" aria-controls="ticket-action-menu-'+ticket.id+'" aria-label="'+esc(STRINGS.ticketActionMenu)+'" title="'+esc(STRINGS.ticketActionMenu)+'"><span class="icon-more" aria-hidden="true">•••</span></button><span class="ticket-action-menu hidden" id="ticket-action-menu-'+ticket.id+'" role="menu">'+actionItems+'</span></span>';
  const expand = hasChildren ? '<button class="expand-btn" type="button" data-expand="'+ticket.id+'" aria-expanded="'+expanded+'" aria-label="'+esc(expanded ? STRINGS.collapseTitle : STRINGS.expandTitle)+'" title="'+esc(expanded ? STRINGS.collapseTitle : STRINGS.expandTitle)+'"><span class="expand-icon '+(expanded?'expanded':'collapsed')+'" aria-hidden="true"></span></button>' : '<span class="expand-placeholder" aria-hidden="true"></span>';
  const assignee = hasAssignee(ticket.assigneeName) ? avatar(ticket.assigneeName,'ticket-avatar') : '';
  return '<div class="ticket-row'+(ticket.level > 0 ? ' child-row' : '')+(selected ? ' selected' : '')+'" data-id="'+ticket.id+'" role="listitem" aria-current="'+selected+'" tabindex="0" style="padding-left:'+(12 + Math.max(0,ticket.level || 0) * 14)+'px">'+expand+'<span class="ticket-id">#'+ticket.id+'</span><span class="ticket-subject" title="'+esc(ticket.subject)+'">'+esc(ticket.subject)+'</span><span class="badges">'+status+due+sync+'</span>'+assignee+actionMenu+'</div>';
}
function isTicketActionTarget(target){ return isElement(target) && !!target.closest('.ticket-action-btn,.ticket-action-menu,.expand-btn'); }
function renderTickets(){
  if(!state) return;
  const list = document.getElementById('ticket-list');
  const focus=captureFocus(list);
  list.setAttribute('aria-busy',String(state.loading.tickets));
  const more = document.getElementById('load-more-row');
  if(state.errors.tickets && !state.loading.tickets){
    list.innerHTML='<div class="state-msg error-msg" role="alert"><strong>'+esc(STRINGS.errorLabel)+'</strong><p>'+esc(state.errors.tickets)+'</p><button id="retry-tickets" class="btn btn-secondary" type="button">'+esc(STRINGS.retry)+'</button></div>';
    list.querySelector('#retry-tickets').addEventListener('click',function(){ if(!state.selectedProject && searchQuery) req('tickets.searchAllProjects',{query:searchInput.value}); else req('dashboard.refresh'); });
    more.classList.add('hidden'); updateSyncButtonStates(); return;
  }
  if(!state.selectedProject && !state.tickets.length && !state.loading.tickets && !searchQuery){ list.innerHTML='<div class="state-msg">'+STRINGS.noProjectSelected+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  if(state.loading.tickets){ list.innerHTML='<div class="state-msg loading-state" role="status">'+esc(STRINGS.loadingTickets)+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  const tickets = (searchQuery ? flattenAll(state.tickets) : flattenVisible(state.tickets)).filter(matchesSearch);
  list.innerHTML = tickets.length ? tickets.map(renderTicketRow).join('') : '<div class="state-msg" role="status"><strong>'+esc(STRINGS.noTicketsFound)+'</strong><p>'+esc(STRINGS.searchEmptyHint)+'</p></div>';
  if(state.loadedTicketCount < state.totalTicketCount){ more.classList.remove('hidden'); more.textContent=STRINGS.loadMore+' ('+state.loadedTicketCount+' / '+state.totalTicketCount+')'; } else more.classList.add('hidden');
  list.querySelectorAll('.ticket-row').forEach(function(row){
    row.addEventListener('click',function(event){ if(isTicketActionTarget(event.target)) return; const id=Number(row.dataset.id); if(state.selectedTicketId === id){ ticketDetailExpanded=true; renderTicketDetail(); } req('ticket.select',{ticketId:id}); });
    row.addEventListener('dblclick',function(event){ if(!isTicketActionTarget(event.target)) req('ticket.openEditor',{ticketId:Number(row.dataset.id)}); });
    row.addEventListener('keydown',function(event){ if(isTicketActionTarget(event.target)) return; if(event.key === 'Enter'){ row.click(); event.preventDefault(); } else if(event.key === ' '){ if(!isTicketActionTarget(event.target)){ row.click(); event.preventDefault(); } } });
  });
  list.querySelectorAll('.expand-btn').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); const id=Number(button.dataset.expand); if(expandedTicketIds.has(id)){ expandedTicketIds.delete(id); collapsedTicketIds.add(id); } else { expandedTicketIds.add(id); collapsedTicketIds.delete(id); } renderTickets(); }); });
  list.querySelectorAll('[data-ticket-action-menu]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); toggleTicketActionMenu(Number(button.dataset.ticketActionMenu)); }); });
  list.querySelectorAll('[data-ticket-action]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); runTicketAction(button.dataset.ticketAction,Number(button.dataset.ticket)); }); });
  more.onclick = function(){ req('tickets.loadMore'); };
  restoreFocus(focus);
  updateSyncButtonStates();
}

// ── Ticket detail / composer ──────────────────────────────────────────────
function measureNewTicketPopoverAnchor(){
  const button=document.getElementById('new-ticket-btn'); if(!button) return;
  const rect=button.getBoundingClientRect(); const width=Math.min(420,Math.max(0,(document.documentElement.clientWidth || window.innerWidth)-16));
  const height=document.documentElement.clientHeight || window.innerHeight;
  newTicketPopoverAnchor={left:clamp(rect.left,8,Math.max(8,(window.innerWidth || 320)-width-8)),top:clamp(rect.bottom+8,8,Math.max(8,height-248)),width:width};
}
function applyNewTicketComposerPosition(card){
  if(!newTicketPopoverAnchor) measureNewTicketPopoverAnchor();
  const anchor=newTicketPopoverAnchor || {left:8,top:8,width:Math.min(420,Math.max(0,(window.innerWidth || 320)-16))};
  card.style.setProperty('--composer-popover-left',anchor.left+'px'); card.style.setProperty('--composer-popover-top',anchor.top+'px'); card.style.setProperty('--composer-popover-width',anchor.width+'px'); card.style.setProperty('--composer-popover-max-height',Math.max(120,(window.innerHeight || 320)-anchor.top-8)+'px');
}
function clearNewTicketComposerPosition(card){ card.classList.remove('composer-popover'); ['left','top','width','max-height'].forEach(function(name){ card.style.removeProperty('--composer-popover-'+name); }); }
function renderSelect(name,value,options,label,disabled,allowBlank){
  const current=value || ''; const list=options || []; const disabledAttribute=disabled ? ' disabled' : '';
  const blank=allowBlank ? '<option value=""'+(!current?' selected':'')+'>'+esc(STRINGS.assigneeUnassigned)+'</option>' : '';
  const optionsHtml=list.map(function(option){ return '<option value="'+esc(option.name)+'"'+(option.name===current?' selected':'')+'>'+esc(option.name)+'</option>'; }).join('');
  return '<label class="detail-field"><span>'+esc(label)+'</span><select class="detail-select" data-metadata-field="'+name+'"'+disabledAttribute+'>'+blank+optionsHtml+'</select></label>';
}
function editOptionsFor(ticketId){ const options=state && state.editOptions; return options && options.ticketId === ticketId ? options : null; }
function metadataOptionsReady(){ return !!(state && state.metadataOptions && state.metadataOptions.trackers.length && state.metadataOptions.priorities.length && state.metadataOptions.statuses.length); }
function renderTicketDetailPanel(ticket){
  const card=document.getElementById('ticket-detail-card'); const node=findTicket(state.tickets,ticket.id) || {}; const options=editOptionsFor(ticket.id); const ready=!!options && !options.loading; const trackerOptions=options ? options.trackers : (state.metadataOptions.trackers || []); const priorityOptions=options ? options.priorities : (state.metadataOptions.priorities || []); const statusOptions=options ? options.statuses : (state.metadataOptions.statuses || []); const assigneeOptions=options ? options.assignees : []; const syncIsPrimary=ticket.syncState !== 'Synced';
  clearNewTicketComposerPosition(card); card.classList.remove('hidden'); card.removeAttribute('aria-busy');
  const description=ticket.description ? '<div class="detail-description'+(ticketDetailExpanded ? '' : ' detail-description-collapsed')+'">'+esc(ticket.description)+'</div>' : '';
  const parent=ticket.parentId ? '<div class="detail-parent">#'+ticket.parentId+(ticket.parentSubject ? ' '+esc(ticket.parentSubject) : '')+'</div>' : '';
  const statusHint=options && options.statusFallback ? '<div class="detail-readonly">'+STRINGS.statusFallbackHint+'</div>' : ''; const loadingHint=options && options.loading ? '<div class="detail-readonly">'+STRINGS.loadingEditOptions+'</div>' : ''; const errorHint=options && options.error ? '<div class="detail-readonly">'+esc(options.error)+'</div>' : '';
  const expanded=ticketDetailExpanded ? '<div class="detail-expanded">'+renderSelect('tracker',ticket.trackerName || node.trackerName,trackerOptions,STRINGS.sortTracker,!ready && !metadataOptionsReady(),false)+renderSelect('priority',ticket.priorityName || node.priorityName,priorityOptions,STRINGS.sortPriority,!ready && !metadataOptionsReady(),false)+renderSelect('assignee',ticket.assigneeName || node.assigneeName,assigneeOptions,STRINGS.sortAssignee,!ready,true)+renderSelect('status',ticket.statusName || node.statusName,statusOptions,STRINGS.sortStatus,!ready && !metadataOptionsReady(),false)+'<label class="detail-field"><span>'+esc(STRINGS.startDate)+'</span><input class="detail-input" type="date" data-metadata-field="start_date" value="'+esc(ticket.startDate || node.startDate || '')+'"></label><label class="detail-field"><span>'+esc(STRINGS.dueDateLabel)+'</span><input class="detail-input" type="date" data-metadata-field="due_date" value="'+esc(ticket.dueDate || node.dueDate || '')+'"></label><div class="detail-meta"><span>'+esc(STRINGS.sectionSync)+'</span><strong>'+esc(syncLabel(ticket.syncState))+'</strong></div>'+loadingHint+errorHint+statusHint+'</div>' : '';
  const assigneeAvatar=hasAssignee(ticket.assigneeName) ? avatar(ticket.assigneeName,'detail-avatar') : '';
  card.innerHTML='<div class="detail-head"><div class="detail-title"><span class="ticket-id">#'+ticket.id+'</span><span>'+esc(ticket.subject)+'</span></div><button class="btn btn-secondary detail-toggle" id="ticket-detail-toggle" type="button" title="'+esc(ticketDetailExpanded?STRINGS.closeDetail:STRINGS.openDetail)+'" aria-label="'+esc(ticketDetailExpanded?STRINGS.closeDetail:STRINGS.openDetail)+'" aria-expanded="'+ticketDetailExpanded+'">'+(ticketDetailExpanded?'⌃':'⌄')+'</button></div><div class="detail-project">'+(ticket.projectName ? esc(ticket.projectName) : esc(STRINGS.projectNone))+'</div>'+parent+assigneeAvatar+description+'<div class="detail-actions"><button class="btn btn-secondary" id="detail-cancel-btn" type="button">'+STRINGS.cancelAction+'</button><button class="btn btn-secondary" id="detail-open-btn" type="button">'+STRINGS.openTicketAction+'</button><button class="btn btn-secondary" id="detail-comment-btn" type="button">'+STRINGS.commentAction+'</button><button class="btn '+(syncIsPrimary?'btn-primary':'btn-secondary')+'" id="detail-sync-btn" type="button">'+STRINGS.syncAction+'</button></div>'+expanded;
  card.querySelector('#ticket-detail-toggle').addEventListener('click',function(){ ticketDetailExpanded=!ticketDetailExpanded; renderTicketDetail(); });
  card.querySelector('#detail-cancel-btn').addEventListener('click',function(){ req('ticket.cancelDetail'); }); card.querySelector('#detail-open-btn').addEventListener('click',function(){ req('ticket.openEditor',{ticketId:ticket.id}); }); card.querySelector('#detail-comment-btn').addEventListener('click',function(){ req('comment.add',{ticketId:ticket.id}); }); card.querySelector('#detail-sync-btn').addEventListener('click',function(){ req('ticket.syncSelected',{ticketId:ticket.id}); });
  card.querySelectorAll('[data-metadata-field]').forEach(function(input){ input.addEventListener('change',function(){ const field=input.dataset.metadataField; const patch={}; patch[field]=input.value; req('ticket.metadata.update',{ticketId:ticket.id,patch:patch}); }); });
}
function renderComposerPanel(panel){
  const nextComposerDraftKey=[panel.mode,panel.projectId,panel.mode === 'childTicket' ? panel.parentTicketId : ''].join(':'); if(composerDraftKey !== nextComposerDraftKey){ composerDraftKey=nextComposerDraftKey; composerDraftValues=null; }
  const card=document.getElementById('ticket-detail-card'); const isNewTicketComposer=panel.mode === 'newTicket'; card.classList.remove('hidden'); card.classList.toggle('composer-popover', isNewTicketComposer); if(isNewTicketComposer) applyNewTicketComposerPosition(card); else clearNewTicketComposerPosition(card);
  const title=panel.mode === 'childTicket' ? STRINGS.createChildTicketTitle : STRINGS.createNewTicketTitle; const parent=panel.mode === 'childTicket' ? '<div class="work-panel-subtitle">'+esc(STRINGS.parentLabel)+': #'+panel.parentTicketId+' '+esc(panel.parentSubject || '')+'</div>' : ''; const error=panel.error ? '<div class="composer-error" role="alert">'+esc(panel.error)+'</div>' : '';
  card.setAttribute('aria-busy',String(panel.loading));
  if(panel.loading){ card.innerHTML='<div class="work-panel-head"><div class="work-panel-title">'+title+'</div>'+parent+'</div><div class="composer-loading">'+STRINGS.loadingTrackers+'</div>'; return; }
  const values=Object.assign({},panel.values || {},composerDraftValues || {}); const options=function(items,key){ return (items || []).map(function(item){ return '<option value="'+esc(item.name)+'"'+(item.name===values[key]?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); }; const canCreate=!!(values.tracker && values.priority);
  card.innerHTML='<div class="work-panel-head"><div class="work-panel-title">'+title+'</div><div class="work-panel-subtitle">'+esc(panel.projectName || (STRINGS.projectLabel+' #'+panel.projectId))+'</div>'+parent+'</div>'+error+'<div class="composer-actions"><button class="btn btn-secondary" id="work-cancel" type="button">'+STRINGS.cancelAction+'</button><button class="btn btn-primary" id="work-create" type="button"'+(canCreate?'':' disabled')+'>'+STRINGS.createDraft+'</button><button class="btn btn-secondary" id="work-sync-new-ticket" type="button">'+STRINGS.syncNewTicket+'</button></div><div class="composer-grid"><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortTracker)+' <span class="composer-required">*</span></span><select class="detail-select" id="work-tracker" required><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.trackers,'tracker')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortPriority)+' <span class="composer-required">*</span></span><select class="detail-select" id="work-priority" required><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.priorities,'priority')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortAssignee)+'</span><select class="detail-select" id="work-assignee"><option value="">'+STRINGS.assigneeUnassigned+'</option>'+options(panel.assignees,'assigned_to')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortStatus)+'</span><select class="detail-select" id="work-status"><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.statuses,'status')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.startDate)+'</span><input class="detail-input" id="work-start-date" type="date" value="'+esc(values.start_date || '')+'"></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.dueDateLabel)+'</span><input class="detail-input" id="work-due-date" type="date" value="'+esc(values.due_date || '')+'"></label><label class="detail-field composer-detail-field composer-description-field"><span>'+esc(STRINGS.descriptionLabel)+'</span><textarea class="detail-input composer-textarea" id="work-description">'+esc(values.description || '')+'</textarea></label></div>';
  const actions=card.querySelector('.composer-actions');
  card.appendChild(actions);
  const hint=document.createElement('p'); hint.className='work-panel-subtitle'; hint.textContent=STRINGS.composerHint; actions.before(hint);
  card.querySelector('#work-sync-new-ticket').disabled=!panel.draftUri;
  const readValues=function(){ return {tracker:document.getElementById('work-tracker').value,priority:document.getElementById('work-priority').value,assigned_to:document.getElementById('work-assignee').value || undefined,status:document.getElementById('work-status').value,start_date:document.getElementById('work-start-date').value || undefined,due_date:document.getElementById('work-due-date').value || undefined,description:document.getElementById('work-description').value}; }; const saveValues=function(){ const current=readValues(); composerDraftValues=current; const create=document.getElementById('work-create'); if(create) create.disabled=!(current.tracker && current.priority); };
  card.querySelector('#work-cancel').addEventListener('click',function(){ req('ticket.cancelComposer'); }); card.querySelector('#work-create').addEventListener('click',function(){ req('ticket.createDraftFromComposer',{values:readValues()}); }); card.querySelector('#work-sync-new-ticket').addEventListener('click',function(){ req('ticket.syncNewTicketDraftFromComposer'); }); card.querySelectorAll('#work-tracker,#work-priority,#work-assignee,#work-status,#work-start-date,#work-due-date,#work-description').forEach(function(input){ input.addEventListener('input',saveValues); input.addEventListener('change',saveValues); });
}
function renderTicketDetail(){
  if(!state) return; const card=document.getElementById('ticket-detail-card'); const panel=state.workPanel;
  document.getElementById('ticket-detail-empty').classList.toggle('hidden',!!(state.selectedTicket || panel));
  if(!panel){ composerDraftKey=null; composerDraftValues=null; if(!state.selectedTicket){ clearNewTicketComposerPosition(card); card.classList.add('hidden'); card.innerHTML=''; return; } renderTicketDetailPanel(state.selectedTicket); return; }
  if(panel.mode === 'detail'){ composerDraftKey=null; composerDraftValues=null; if(state.selectedTicket && state.selectedTicket.id === panel.ticketId) renderTicketDetailPanel(state.selectedTicket); else { clearNewTicketComposerPosition(card); card.classList.add('hidden'); card.innerHTML=''; } return; }
  renderComposerPanel(panel);
}

// ── Filter chips ───────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const filters=state.settings.filters;
  const labels=[];
  if(filters.subjectQuery) labels.push(STRINGS.filterSubjectPrefix+filters.subjectQuery);
  if((filters.assigneeIds || []).length) labels.push(STRINGS.filterAssigneeCount+': '+filters.assigneeIds.length);
  if(filters.includeUnassigned) labels.push(STRINGS.filterIncludeUnassigned);
  if((filters.statusIds || []).length) labels.push(STRINGS.filterStatusCount+': '+filters.statusIds.length);
  const element=document.getElementById('filter-chips');
  if(element) element.innerHTML=labels.map(function(label){ return '<span class="filter-chip">'+esc(label)+'</span>'; }).join('');
}

// ── Unsynced ───────────────────────────────────────────────────────────────
const UNSYNCED_BADGE_META={
  queued:{kind:'queued',label:STRINGS.syncQueued,cls:'sync-queued',icon:'→'},
  recovery_pending:{kind:'review',label:STRINGS.syncReviewRequired || STRINGS.syncFailed,cls:'sync-conflict',icon:'△',requiresReview:true},
  commit_unknown:{kind:'review',label:STRINGS.syncReviewRequired || STRINGS.syncFailed,cls:'sync-conflict',icon:'△',requiresReview:true},
  conflict:{kind:'conflict',label:STRINGS.syncConflict,cls:'sync-conflict',icon:'△'},
  failed:{kind:'failed',label:STRINGS.syncFailed,cls:'sync-failed',icon:'×'},
};
function resolveUnsyncedBadge(item){
  const lifecycle=item && typeof item.lifecycle === 'string' ? item.lifecycle : 'queued';
  return UNSYNCED_BADGE_META[lifecycle] || UNSYNCED_BADGE_META.queued;
}
function unsyncedKindLabel(kind){ return kind === 'ticket' ? STRINGS.unsyncedKindTicket : kind === 'newTicket' ? STRINGS.unsyncedKindNewTicket : kind === 'comment' ? STRINGS.unsyncedKindComment : STRINGS.unsyncedKindFile; }
function renderUnsynced(){
  if(!state) return; const items=state.unsynced.items || []; const count=state.unsynced.totalCount || 0; const tabBadge=document.getElementById('unsynced-badge'); tabBadge.textContent=String(count); tabBadge.setAttribute('aria-label',String(count)); tabBadge.classList.toggle('hidden',count === 0);
  const countLabel=document.getElementById('unsynced-count-label'); countLabel.textContent=(STRINGS.unsyncedCountLabel || STRINGS.tabUnsynced).replace('{0}',String(count)); const syncAll=document.getElementById('sync-all-btn'); syncAll.classList.toggle('hidden',count === 0); syncAll.onclick=function(){ req('unsynced.syncAll'); };
  const queued=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'queued'; }).length; const review=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'review'; }).length; const conflict=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'conflict'; }).length; const failed=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'failed'; }).length; const summary=document.getElementById('unsynced-summary'); summary.innerHTML=(queued ? '<span class="summary-badge">'+esc(STRINGS.syncQueued)+' <strong>'+queued+'</strong></span>' : '')+(review ? '<span class="summary-badge">'+esc(STRINGS.syncReviewRequired || STRINGS.syncFailed)+' <strong>'+review+'</strong></span>' : '')+(conflict ? '<span class="summary-badge">'+esc(STRINGS.syncConflict)+' <strong>'+conflict+'</strong></span>' : '')+(failed ? '<span class="summary-badge">'+esc(STRINGS.syncFailed)+' <strong>'+failed+'</strong></span>' : '');
  const list=document.getElementById('unsynced-list'); if(!items.length){ list.innerHTML='<div class="state-msg">'+STRINGS.noUnsyncedChanges+'</div>'; updateSyncButtonStates(); return; }
  list.innerHTML=items.map(function(item){ const status=resolveUnsyncedBadge(item); const open=item.documentUri ? '<button class="btn btn-secondary" type="button" data-uri="'+esc(item.documentUri)+'">'+STRINGS.openFileAction+'</button>' : ''; const discard=item.canDiscard === false ? '<button class="btn btn-secondary" type="button" disabled>'+STRINGS.discardAction+'</button>' : '<button class="btn btn-secondary" type="button" data-discard-key="'+safeJson(item.key)+'" title="'+esc(STRINGS.discardTitle)+'">'+STRINGS.discardAction+'</button>'; const sync=item.canSync === false ? '<button class="btn btn-secondary" type="button" disabled>'+STRINGS.syncAction+'</button>' : '<button class="btn btn-secondary" type="button" data-sync-key="'+safeJson(item.key)+'">'+STRINGS.syncAction+'</button>'; const detail=status.requiresReview ? (STRINGS.syncReviewRequired || STRINGS.syncFailed) : (item.detail || ''); return '<div class="unsynced-card" role="listitem"><span class="unsynced-kind-label">'+esc(unsyncedKindLabel(item.key.kind))+'</span><div class="unsynced-body"><div class="unsynced-label">'+esc(item.label)+'</div>'+(detail ? '<div class="unsynced-detail">'+esc(detail)+'</div>' : '')+'</div><div class="unsynced-state">'+badge(status.label,status.cls,status.icon)+'</div><div class="unsynced-actions">'+open+discard+sync+'</div></div>'; }).join('');
  list.querySelectorAll('[data-uri]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.openLocalFile',{documentUri:button.dataset.uri}); }); });
  list.querySelectorAll('[data-discard-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.discardOne',{key:JSON.parse(button.getAttribute('data-discard-key'))}); } catch {} }); });
  list.querySelectorAll('[data-sync-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.syncOne',{key:JSON.parse(button.getAttribute('data-sync-key'))}); } catch {} }); });
  updateSyncButtonStates();
}

// ── Comments ───────────────────────────────────────────────────────────────
function renderComments(){
  if(!state) return; const comments=state.comments; const list=document.getElementById('comments-list'); const ticketId=state.selectedTicketId; list.setAttribute('aria-busy',String(comments.loading)); const firstLine=s=>String(s||'').split(/\r?\n/)[0];
  if(ticketId === undefined){ list.innerHTML='<div class="state-msg">'+STRINGS.noTicketSelected+'</div>'; return; }
  const header='<div class="comments-header"><span class="comments-header-label">'+esc(STRINGS.commentsForTicket)+' #'+ticketId+'</span><div class="comments-header-actions"><button class="btn btn-primary" id="add-comment-btn" type="button">'+STRINGS.addCommentBtn+'</button><button class="btn btn-secondary" id="reload-comments-btn" type="button">'+STRINGS.reloadComments+'</button></div></div>';
  let content='';
  if(comments.loading) content='<div class="state-msg">'+STRINGS.loadingComments+'</div>'; else if(comments.error) content='<div class="state-msg error-msg">'+esc(comments.error)+'</div>'; else if(!comments.items.length) content='<div class="state-msg">'+STRINGS.noComments+'</div>'; else content='<div class="comment-list" role="list">'+comments.items.map(function(cm){ const unsynced=cm.hasUnsyncedEdit ? badge(STRINGS.unsyncedEditBadge,'sync-dirty','•') : ''; const syncBtn=cm.syncKey?'<button class="btn btn-secondary" type="button" data-sync-comment-key="'+esc(JSON.stringify(cm.syncKey))+'">'+STRINGS.syncAction+'</button>':''; const editBtn=cm.id&&cm.editableByCurrentUser?'<button class="btn btn-secondary" type="button" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="'+esc(STRINGS.editCommentAction)+'">'+STRINGS.editCommentAction+'</button>':''; const browserBtn=cm.id?'<button class="btn btn-secondary" type="button" data-open-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="'+esc(STRINGS.openInRedmine)+'">'+STRINGS.openInRedmine+'</button>':''; const journalId=cm.id?'<span class="comment-id">#'+cm.id+'</span>':''; return '<article class="comment-card" role="listitem"><div class="comment-header"><div class="comment-identity">'+avatar(cm.authorName,'comment-avatar')+'<div class="comment-meta"><span class="comment-author">'+esc(cm.authorName)+'</span>'+(cm.updatedAt?'<span class="comment-date">'+esc(cm.updatedAt.substring(0,10))+'</span>':'')+journalId+'</div></div><div class="comment-status">'+unsynced+'</div></div><div class="comment-body">'+esc(firstLine(cm.body))+'</div><div class="comment-actions">'+browserBtn+editBtn+syncBtn+'</div></article>'; }).join('')+'</div>';
  list.innerHTML=header+content; list.querySelector('#add-comment-btn')?.addEventListener('click',function(){ req('comment.add',{ticketId:ticketId}); }); list.querySelector('#reload-comments-btn')?.addEventListener('click',function(){ req('comment.reload',{ticketId:ticketId}); });
  list.querySelectorAll('[data-edit-comment]').forEach(function(button){ button.addEventListener('click',function(){ req('comment.edit',{ticketId:Number(button.dataset.ticket),commentId:Number(button.dataset.editComment)}); }); }); list.querySelectorAll('[data-open-comment]').forEach(function(button){ button.addEventListener('click',function(){ req('comment.openBrowser',{ticketId:Number(button.dataset.ticket),commentId:Number(button.dataset.openComment)}); }); });
  list.querySelectorAll('[data-sync-comment-key]').forEach(function(btn){ btn.addEventListener('click',function(){ try { req('unsynced.syncOne',{key:JSON.parse(btn.getAttribute('data-sync-comment-key'))}); } catch {} }); });
  updateSyncButtonStates();
}

// ── Settings ──────────────────────────────────────────────────────────────
const sortFields=function(){ return [['',STRINGS.sortDefaultOption],['priority',STRINGS.sortPriority],['status',STRINGS.sortStatus],['tracker',STRINGS.sortTracker],['assignee',STRINGS.sortAssignee]]; };
function selectOptions(options,current){ return options.map(function(option){ return '<option value="'+esc(option[0])+'"'+(option[0] === current ? ' selected' : '')+'>'+esc(option[1])+'</option>'; }).join(''); }
function dueToggles(rule){ return [['set-dd-overdue','showOverdue',STRINGS.dueOverdue],['set-dd-1d','showWithin1Day',STRINGS.due1Day],['set-dd-3d','showWithin3Days',STRINGS.due3Days],['set-dd-7d','showWithin7Days',STRINGS.due7Days]].map(function(item){ return '<label class="setting-row"><span class="setting-label">'+esc(item[2])+'</span><input class="setting-check" type="checkbox" id="'+item[0]+'"'+(rule[item[1]]?' checked':'')+'></label>'; }).join(''); }
function renderSettingsBase(){
  if(!state) return; const settings=state.settings; const element=document.getElementById('settings-content'); element.innerHTML='<section class="settings-section"><h3>'+STRINGS.sectionTicketFilter+'</h3><div id="quick-filter-row"><label class="quick-filter-label" for="assignee-filter-select">'+STRINGS.filterAssigneeLabel+'</label><select id="assignee-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterAssigneeAria)+'"></select><label class="quick-filter-check"><input type="checkbox" id="assignee-unassigned-toggle"> '+STRINGS.filterIncludeUnassignedLabel+'</label><label class="quick-filter-label" for="status-filter-select">'+STRINGS.filterStatusLabel+'</label><select id="status-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterStatusAria)+'"></select></div></section><section class="settings-section"><h3>'+STRINGS.sectionSort+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.sortFieldLabel+'</span><select class="setting-select" id="set-sort-field">'+selectOptions(sortFields(),settings.sort.field || '')+'</select></label><label class="setting-row"><span class="setting-label">'+STRINGS.sortDirectionLabel+'</span><select class="setting-select" id="set-sort-dir">'+selectOptions([['asc',STRINGS.sortAsc],['desc',STRINGS.sortDesc]],settings.sort.direction)+'</select></label></section><section class="settings-section"><h3>'+STRINGS.sectionDueDate+'</h3>'+dueToggles(settings.dueDate)+'</section><section class="settings-section"><h3>'+STRINGS.sectionSync+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.offlineSyncModeLabel+'</span><select class="setting-select" id="set-sync-mode">'+selectOptions([['auto',STRINGS.offlineSyncAuto],['manual',STRINGS.offlineSyncManual]],settings.offlineSyncMode)+'</select></label></section><section class="settings-section"><h3>'+STRINGS.sectionGeneral+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.ticketLimitLabel+'</span><input class="setting-input setting-input-num" id="set-ticket-limit" type="number" min="1" max="500" value="'+settings.ticketListLimit+'"></label></section><section class="settings-section"><h3>'+STRINGS.sectionApiKey+'</h3><div class="setting-row"><span class="setting-label">'+STRINGS.sectionApiKey+'</span><span class="setting-value apikey-status apikey-status-'+(settings.apiKeyStatus === 'set'?'set':'notset')+'">'+(settings.apiKeyStatus === 'set'?STRINGS.apiKeyStatusSet:STRINGS.apiKeyStatusNotSet)+'</span></div><div class="apikey-actions"><button class="btn btn-secondary" id="set-apikey-btn" type="button">'+STRINGS.setApiKeyBtn+'</button>'+(settings.apiKeyStatus === 'set'?'<button class="btn btn-secondary" id="clear-apikey-btn" type="button">'+STRINGS.clearApiKeyBtn+'</button>':'')+'</div></section>';
  const assignees=state.ticketFilterOptions.assignees || []; const statuses=state.ticketFilterOptions.statuses || []; const assigneeSelect=document.getElementById('assignee-filter-select'); const statusSelect=document.getElementById('status-filter-select'); assigneeSelect.innerHTML=assignees.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.assigneeIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); statusSelect.innerHTML=statuses.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.statusIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); assigneeSelect.disabled=!assignees.length; statusSelect.disabled=!statuses.length; document.getElementById('assignee-unassigned-toggle').checked=!!settings.filters.includeUnassigned;
  const updateFilters=function(){ req('settings.update',{patch:{filters:Object.assign({},settings.filters,{assigneeIds:Array.from(assigneeSelect.selectedOptions).map(function(option){ return Number(option.value); }),statusIds:Array.from(statusSelect.selectedOptions).map(function(option){ return Number(option.value); }),includeUnassigned:document.getElementById('assignee-unassigned-toggle').checked})}}); }; assigneeSelect.addEventListener('change',updateFilters); statusSelect.addEventListener('change',updateFilters); document.getElementById('assignee-unassigned-toggle').addEventListener('change',updateFilters);
  document.getElementById('set-sort-field').addEventListener('change',function(){ req('settings.update',{patch:{sort:{field:this.value || undefined,direction:settings.sort.direction}}}); }); document.getElementById('set-sort-dir').addEventListener('change',function(){ req('settings.update',{patch:{sort:{field:settings.sort.field,direction:this.value}}}); });
  [['set-dd-overdue','showOverdue'],['set-dd-1d','showWithin1Day'],['set-dd-3d','showWithin3Days'],['set-dd-7d','showWithin7Days']].forEach(function(item){ document.getElementById(item[0]).addEventListener('change',function(){ const due=Object.assign({},settings.dueDate); due[item[1]]=this.checked; req('settings.update',{patch:{dueDate:due}}); }); });
  document.getElementById('set-sync-mode').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{offlineSyncMode:this.value}}); }); document.getElementById('set-ticket-limit').addEventListener('change',function(){ const value=Number(this.value); if(value >= 1 && value <= 500) req('settings.updateGeneral',{patch:{ticketListLimit:value}}); }); document.getElementById('set-apikey-btn').addEventListener('click',function(){ req('apiKey.set'); }); document.getElementById('clear-apikey-btn')?.addEventListener('click',function(){ req('apiKey.clear'); }); document.getElementById('settings-reset-btn').onclick=function(){ req('settings.reset'); };
}

function renderSettings(){
  renderSettingsBase();
  const settings=state.settings;
  const element=document.getElementById('settings-content');
  element.insertAdjacentHTML('afterbegin','<section class="settings-section"><h3>'+STRINGS.sectionDisplay+'</h3><label class="setting-row" for="set-show-status"><span class="setting-label">'+STRINGS.showStatusLabel+'</span><input class="setting-check" id="set-show-status" type="checkbox"'+(settings.showStatus?' checked':'')+'></label><label class="setting-row" for="set-show-due-date"><span class="setting-label">'+STRINGS.showDueDateLabel+'</span><input class="setting-check" id="set-show-due-date" type="checkbox"'+(settings.showDueDate?' checked':'')+'></label></section>');
  document.getElementById('set-show-status').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showStatus:this.checked}}); });
  document.getElementById('set-show-due-date').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showDueDate:this.checked}}); });
}

// ── Render and extension messages ─────────────────────────────────────────
function render(){
  if(!state) return; const focus=captureFocus(document); closeTicketActionMenus(); syncExpandedState(state.tickets);
  const select=document.getElementById('project-select'); while(select.options.length > 1) select.remove(1);
  (state.projects || []).forEach(function(project){ const option=document.createElement('option'); option.value=String(project.id); option.textContent='  '.repeat(project.level || 0)+(project.name || (STRINGS.projectLabel+' #'+project.id)); select.appendChild(option); }); if(state.selectedProject && state.selectedProject.id) select.value=String(state.selectedProject.id); else select.value='';
  document.getElementById('include-children').checked=!!state.includeChildProjects; renderTickets(); renderTicketDetail(); renderFilterChips(); renderUnsynced(); renderComments(); renderSettings(); updateSyncButtonStates(); restoreFocus(focus);
}
window.addEventListener('resize',function(){ const card=document.getElementById('ticket-detail-card'); if(state && state.workPanel && state.workPanel.mode === 'newTicket' && card.classList.contains('composer-popover')){ measureNewTicketPopoverAnchor(); applyNewTicketComposerPosition(card); } });
window.addEventListener('message',function(event){ const message=event.data || {}; if(message.type === 'dashboard.state'){
    const previous=state;
    const projectChanged=previous?.selectedProject?.id !== message.state.selectedProject?.id;
    if(projectChanged){ expandedTicketIds.clear(); collapsedTicketIds.clear(); }
    const previousComposer=previous?.workPanel;
    state=message.state;
    const panel=state.workPanel;
    const openingComposer=panel && panel.mode !== 'detail' && (!previousComposer || previousComposer.mode !== panel.mode || previousComposer.projectId !== panel.projectId);
    if(openingComposer) activateTab('tickets');
    render();
    if(panel && panel.mode !== 'detail' && !panel.loading && (openingComposer || previousComposer?.loading)) document.getElementById('work-tracker')?.focus();
    if(previousComposer?.mode === 'newTicket' && (!panel || panel.mode === 'detail')) document.getElementById('new-ticket-btn').focus();
  } else if(message.type === 'operation.started'){ startOperation(message.requestId,message.label); } else if(message.type === 'operation.success'){ endOperation(message.requestId); finishOperation('success',message.requestId,message.message); showToast('success',message.message); } else if(message.type === 'operation.error'){ endOperation(message.requestId); finishOperation('error',message.requestId,message.message); showToast('error',message.message); } else if(message.type === 'toast'){ showToast(message.level,message.message); } });
req('dashboard.ready');
`;
