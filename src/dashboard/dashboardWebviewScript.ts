import { dashboardActionPaths } from "./dashboardActionIcons";

/** Dashboard Webview — ブラウザ側スクリプト (HTML に埋め込む文字列) */
export const dashboardWebviewScript = String.raw`
'use strict';
const vscode = acquireVsCodeApi();
const STRINGS = window.STRINGS;
const persistedUiState = vscode.getState() || {};
let ticketLayoutMode = ['auto','single','split'].includes(persistedUiState.ticketLayoutMode) ? persistedUiState.ticketLayoutMode : 'auto';
let detailTab = persistedUiState.detailTab === 'comments' ? 'comments' : 'overview';
const quickFilters = new Set(Array.isArray(persistedUiState.quickFilters) ? persistedUiState.quickFilters.filter(function(value){ return ['mine','open','overdue','unsynced'].includes(value); }) : []);

// 業務状態は DashboardState、Webview 固有のレイアウト選択はvscode.setStateで保持する。
// 以下はそれ以外の表示用一時状態。
let state = null;
let requestCounter = 0;
let searchQuery = '';
let searchTimer = null;
let ticketDetailExpanded = false;
let metadataExpanded = false;
const expandedComments = new Set();
let renderedDetailTicketId = null;
let activeTicketActionMenuId = null;
let activeTicketActionAnchorTop = null;
let composerDraftKey = null;
let composerDraftValues = null;
let metadataEdit = null;
const ticketSyncRequests = new Map();
const expandedTicketIds = new Set();
const collapsedTicketIds = new Set();
const activeSyncRequests = new Set();
const unsyncedFeedbackRequests = new Set();

function esc(value){ return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function send(message){ vscode.postMessage(message); }
function req(type, extra){
  const requestId='req-'+(++requestCounter);
  if(type === 'unsynced.syncOne' || type === 'unsynced.syncAll') unsyncedFeedbackRequests.add(requestId);
  if(type === 'ticket.syncSelected' || type === 'ticket.reviewConflict'){
    if(activeSyncRequests.size || state?.selectedTicket?.syncState === 'Syncing' || metadataEdit?.requestId) return;
    ticketSyncRequests.set(requestId,extra.ticketId);
    activeSyncRequests.add(requestId);
    updateSyncButtonStates();
  }
  send(Object.assign({type:type,requestId:requestId}, extra || {}));
  return requestId;
}
function isElement(value){ return !!value && typeof value.closest === 'function'; }
function clamp(value, min, max){ return Math.min(Math.max(value, min), max); }
function safeJson(value){ try { return esc(JSON.stringify(value)); } catch { return ''; } }

// DOM 更新後も同じコントロールへ戻す。入力値や選択位置はフォーム側で保持する。
function captureFocus(root){
  const element=document.activeElement;
  if(!element || !root.contains(element)) return null;
  let selector=element.id ? '#'+CSS.escape(element.id) : null;
  if(!selector){
    const attributes=['data-ticket-action-menu','data-ticket-action','data-expand','data-expand-comment','data-metadata-field','data-id'];
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
  document.querySelectorAll('[data-sync-key],[data-discard-key],[data-sync-comment-key],[data-ticket-action="sync"]').forEach(function(button){ button.disabled = busy; });
  const detailSync = document.getElementById('detail-sync-btn');
  const selectedSyncing = state?.selectedTicket?.syncState === 'Syncing' || Array.from(ticketSyncRequests.values()).includes(state?.selectedTicket?.id);
  if(detailSync){
    detailSync.disabled = busy || selectedSyncing || !!metadataEdit?.requestId;
    detailSync.setAttribute('aria-busy',String(selectedSyncing));
    detailSync.querySelector('span').textContent = selectedSyncing ? STRINGS.syncSyncing : STRINGS.syncToRedmine;
  }
  const detailState=document.getElementById('detail-sync-state');
  if(detailState && state?.selectedTicket){
    const metadataDirty=metadataEdit?.ticketId === state.selectedTicket.id && Object.keys(metadataPatch()).length > 0;
    const recoveryPending=['CommitUnknown','RecoveryPending'].includes(state.selectedTicket.syncState);
    const value=selectedSyncing ? 'Syncing' : metadataDirty && !recoveryPending ? 'Dirty' : state.selectedTicket.syncState;
    detailState.className='detail-sync-state '+syncBadgeClass(value);
    detailState.textContent=syncLabel(value);
  }
  const syncAll = document.getElementById('sync-all-btn');
  if(syncAll){ syncAll.disabled = busy; syncAll.setAttribute('aria-busy', String(busy)); }
  document.querySelectorAll('#sync-tray [data-sync-tray-action]').forEach(function(button){ button.disabled=busy; });
}
function startOperation(requestId, label){
  activeSyncRequests.add(requestId);
  if(unsyncedFeedbackRequests.has(requestId)) setOperationFeedback('info', label || STRINGS.syncSyncing);
  updateSyncButtonStates();
}
function deriveSyncTrayState(){
  const all=flattenAll(state.tickets || []);
  const items=state.unsynced.items || [];
  const count=state.unsynced.totalCount || 0;
  const conflict=all.find(function(ticket){ return ticket.syncState === 'Conflict' && Number.isSafeInteger(ticket.id) && ticket.id > 0; });
  if(conflict) return {kind:'conflict',ticketId:conflict.id,count:count};
  const hasRecovery=all.some(function(ticket){ return ticket.syncState === 'RecoveryPending' || ticket.syncState === 'CommitUnknown'; }) || items.some(function(item){ return item.requiresReview === true || ['recovery_pending','commit_unknown'].includes(item.lifecycle); });
  if(hasRecovery) return {kind:'recovery',count:count};
  const failed=all.find(function(ticket){ return ticket.syncState === 'Failed' && Number.isSafeInteger(ticket.id) && ticket.id > 0; });
  if(failed){
    const hasTicketQueue=items.some(function(item){ return item.key?.kind === 'ticket' && item.key.ticketId === failed.id; });
    return {kind:hasTicketQueue?'failedQueued':'failedTicket',ticketId:failed.id,count:count};
  }
  return count ? {kind:'pending',count:count} : {kind:'clear'};
}
function renderSyncTray(){
  if(!state) return;
  const tray=document.getElementById('sync-tray'); tray.replaceChildren();
  const model=deriveSyncTrayState();
  const message=document.createElement('span'); message.className='sync-tray-message'; message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  message.textContent=model.kind === 'failedTicket'
    ? '⚠ '+STRINGS.syncTrayAttention+' · '+STRINGS.syncTrayFailedTicket.replace('{0}',String(model.ticketId))
    : model.kind === 'clear'
      ? '✓ '+STRINGS.syncTrayAllClear
      : model.kind === 'pending'
        ? '↑ '+STRINGS.syncTrayItems.replace('{0}',String(model.count))
        : '⚠ '+STRINGS.syncTrayAttention+' · '+STRINGS.syncTrayItems.replace('{0}',String(model.count));
  tray.appendChild(message);
  const addButton=function(label,primary,action,syncAction){ const button=document.createElement('button'); button.type='button'; button.className='btn '+(primary?'btn-primary':'btn-secondary'); button.textContent=label; if(syncAction) button.dataset.syncTrayAction='true'; button.disabled=!!syncAction && activeSyncRequests.size > 0; button.addEventListener('click',function(){ if(syncAction) button.disabled=true; action(); }); tray.appendChild(button); };
  if(model.kind === 'conflict'){
    addButton(STRINGS.syncTrayReviewConflict,false,function(){ activateTab('tickets'); req('ticket.reviewConflict',{ticketId:model.ticketId}); },true);
    addButton(STRINGS.syncTrayOpenUnsynced,true,function(){ activateTab('unsynced'); });
  } else if(model.kind === 'recovery' || model.kind === 'failedQueued'){
    addButton(STRINGS.syncTrayOpenUnsynced,true,function(){ activateTab('unsynced'); });
  } else if(model.kind === 'failedTicket'){
    addButton(STRINGS.syncTrayOpenEditor,true,function(){ activateTab('tickets'); req('ticket.openEditor',{ticketId:model.ticketId}); });
  } else if(model.kind === 'pending'){
    addButton(STRINGS.syncAllBtn,true,function(){ req('unsynced.syncAll'); },true);
  }
}
function endOperation(requestId){ ticketSyncRequests.delete(requestId); activeSyncRequests.delete(requestId); updateSyncButtonStates(); }
function finishMetadataOperation(requestId, succeeded){
  if(metadataEdit?.requestId !== requestId) return;
  if(succeeded) metadataEdit=null; else metadataEdit.requestId=null;
  renderTicketDetail();
  document.getElementById(succeeded ? 'metadata-edit-btn' : 'metadata-apply-btn')?.focus();
}
function finishOperation(level, requestId, message){ if(unsyncedFeedbackRequests.delete(requestId)) setOperationFeedback(level, message); }

// ── Tabs ───────────────────────────────────────────────────────────────────
const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"]'));
const panels = Array.from(document.querySelectorAll('#content > [role="tabpanel"]'));
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
document.getElementById('new-ticket-btn').addEventListener('click', function(){ activateTab('tickets'); req('ticket.create'); });
document.getElementById('include-children').addEventListener('change', function(){ req('project.toggleChildren',{includeChildProjects:this.checked}); });
document.getElementById('project-select').addEventListener('change', function(){ if(this.value) req('project.select',{projectId:Number(this.value)}); });
const searchInput = document.getElementById('search-input');
const searchClearButton = document.getElementById('search-clear-btn');
const ticketLayoutSelect = document.getElementById('ticket-layout-mode');
const layoutButton = document.getElementById('layout-btn');
const layoutPopover = document.getElementById('layout-popover');
function closeLayoutPopover(){ layoutPopover.classList.add('hidden'); layoutButton.setAttribute('aria-expanded','false'); }
layoutButton.addEventListener('click',function(){ const opening=layoutPopover.classList.contains('hidden'); layoutPopover.classList.toggle('hidden',!opening); layoutButton.setAttribute('aria-expanded',String(opening)); if(opening){ const anchor=layoutButton.getBoundingClientRect(); const bounds=layoutPopover.getBoundingClientRect(); layoutPopover.style.left=Math.max(8,Math.min(anchor.right-bounds.width,window.innerWidth-bounds.width-8))+'px'; layoutPopover.style.top=Math.max(8,Math.min(anchor.bottom+4,window.innerHeight-bounds.height-8))+'px'; ticketLayoutSelect.focus(); } });
document.addEventListener('click',function(event){ if(!isElement(event.target) || !event.target.closest('.layout-control,.layout-popover')) closeLayoutPopover(); });
document.addEventListener('scroll',function(event){ if(!layoutPopover.classList.contains('hidden') && event.target !== layoutPopover) closeLayoutPopover(); },true);
layoutPopover.addEventListener('keydown',function(event){ if(event.key === 'Escape'){ closeLayoutPopover(); layoutButton.focus(); event.preventDefault(); } });
function applyTicketLayoutMode(){
  const layout=document.querySelector('.tickets-layout');
  layout.classList.toggle('layout-single',ticketLayoutMode === 'single');
  layout.classList.toggle('layout-split',ticketLayoutMode === 'split');
  ticketLayoutSelect.value=ticketLayoutMode;
}
ticketLayoutSelect.addEventListener('change',function(){
  ticketLayoutMode=this.value;
  vscode.setState(Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode}));
  applyTicketLayoutMode();
  closeLayoutPopover(); layoutButton.focus();
});
applyTicketLayoutMode();
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
function persistViewState(){ vscode.setState(Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode,detailTab:detailTab,quickFilters:Array.from(quickFilters)})); }
document.querySelectorAll('[data-quick-filter]').forEach(function(button){ button.addEventListener('click',function(){
  const name=button.dataset.quickFilter;
  if(quickFilters.has(name)) quickFilters.delete(name); else quickFilters.add(name);
  persistViewState(); renderTickets();
}); });
const filterDialog=document.getElementById('advanced-filter-dialog');
const filterTrigger=document.getElementById('advanced-filters-btn');
function closeFilterDialog(){ filterDialog.classList.add('hidden'); filterTrigger.focus(); }
function openFilterDialog(){
  if(!state) return;
  const filters=state.settings.filters;
  const options=state.metadataOptions;
  const choices=function(items,selected){ return (items || []).map(function(item){ return '<option value="'+item.id+'"'+((selected || []).includes(item.id)?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); };
  document.getElementById('filter-dialog-fields').innerHTML='<label>'+esc(STRINGS.filterSubjectPrefix)+'<input id="advanced-subject" type="text" value="'+esc(filters.subjectQuery)+'"></label>'+
    '<label>'+esc(STRINGS.sortStatus)+'<select id="advanced-status" multiple size="4">'+choices(state.ticketFilterOptions.statuses,filters.statusIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortPriority)+'<select id="advanced-priority" multiple size="4">'+choices(options.priorities,filters.priorityIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortTracker)+'<select id="advanced-tracker" multiple size="4">'+choices(options.trackers,filters.trackerIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortAssignee)+'<select id="advanced-assignee" multiple size="4">'+choices(state.ticketFilterOptions.assignees,filters.assigneeIds)+'</select></label>'+
    '<label class="filter-check"><input id="advanced-unassigned" type="checkbox"'+(filters.includeUnassigned?' checked':'')+'>'+esc(STRINGS.filterIncludeUnassignedLabel)+'</label>';
  filterDialog.classList.remove('hidden'); document.getElementById('advanced-subject').focus();
}
filterTrigger.addEventListener('click',openFilterDialog);
document.getElementById('filter-dialog-close').addEventListener('click',closeFilterDialog);
filterDialog.addEventListener('click',function(event){ if(event.target === filterDialog) closeFilterDialog(); });
filterDialog.addEventListener('keydown',function(event){
  if(event.key === 'Escape'){ closeFilterDialog(); event.preventDefault(); return; }
  if(event.key !== 'Tab') return;
  const focusable=Array.from(filterDialog.querySelectorAll('button,input,select')).filter(function(item){ return !item.disabled; });
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey && document.activeElement === first){ last.focus(); event.preventDefault(); }
  else if(!event.shiftKey && document.activeElement === last){ first.focus(); event.preventDefault(); }
});
function selectedIds(id){ return Array.from(document.getElementById(id).selectedOptions).map(function(option){ return Number(option.value); }); }
document.getElementById('filter-dialog-apply').addEventListener('click',function(){
  req('settings.update',{patch:{filters:{subjectQuery:document.getElementById('advanced-subject').value, statusIds:selectedIds('advanced-status'),priorityIds:selectedIds('advanced-priority'),trackerIds:selectedIds('advanced-tracker'),assigneeIds:selectedIds('advanced-assignee'),includeUnassigned:document.getElementById('advanced-unassigned').checked}}}); closeFilterDialog();
});
document.getElementById('filter-dialog-reset').addEventListener('click',function(){
  req('settings.update',{patch:{filters:{subjectQuery:'',statusIds:[],priorityIds:[],trackerIds:[],assigneeIds:[],includeUnassigned:true}}}); closeFilterDialog();
});

// ── Display helpers ───────────────────────────────────────────────────────
const SYNC_META = {
  Dirty: {label:STRINGS.syncDirty, badge:'sync-dirty', icon:'•'},
  Queued: {label:STRINGS.syncQueued, badge:'sync-queued', icon:'→'},
  RecoveryPending: {label:STRINGS.syncReviewRequired, badge:'sync-conflict', icon:'△'},
  CommitUnknown: {label:STRINGS.syncReviewRequired, badge:'sync-conflict', icon:'△'},
  Conflict: {label:STRINGS.syncConflict, badge:'sync-conflict', icon:'△'},
  Failed: {label:STRINGS.syncFailed, badge:'sync-failed', icon:'×'},
  Syncing: {label:STRINGS.syncSyncing, badge:'sync-syncing', icon:'↻'},
};
function syncLabel(value){ return SYNC_META[value] ? SYNC_META[value].label : value === 'Synced' ? STRINGS.synced : value === 'Draft' ? STRINGS.draft : String(value || ''); }
function syncBadgeClass(value){ return SYNC_META[value] ? SYNC_META[value].badge : ''; }
function badge(label, className, icon){
  return '<span class="badge '+(className || '')+'"><span class="badge-icon" aria-hidden="true">'+esc(icon || '•')+'</span><span>'+esc(label)+'</span></span>';
}
function metadataBadge(label, className, category){
  return label ? '<span class="badge ticket-metadata '+className+'" title="'+esc(category+': '+label)+'" aria-label="'+esc(category+': '+label)+'">'+esc(label)+'</span>' : '';
}
function actionIcon(name){
  const paths=${JSON.stringify(dashboardActionPaths)};
  return '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+paths[name]+'"/></svg>';
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
function quickFilterCapability(name){
  if(name === 'mine') return state?.quickFilterCapabilities?.mine || 'loading';
  if(name === 'open') return state?.quickFilterCapabilities?.open || 'loading';
  return 'available';
}
function hasEffectiveQuickFilters(){
  return quickFilters.has('overdue') || quickFilters.has('unsynced') ||
    (quickFilters.has('mine') && quickFilterCapability('mine') === 'available') ||
    (quickFilters.has('open') && quickFilterCapability('open') === 'available');
}
function matchesQuickFilters(ticket){
  if(quickFilters.has('mine') && quickFilterCapability('mine') === 'available' && ticket.assigneeId !== state.currentUserId) return false;
  if(quickFilters.has('open') && quickFilterCapability('open') === 'available'){
    const status=(state.metadataOptions?.statuses || []).find(function(item){ return item.id === ticket.statusId; });
    if(!status || status.isClosed !== false) return false;
  }
  if(quickFilters.has('overdue') && !(daysUntilDateOnly(ticket.dueDate,new Date()) < 0)) return false;
  if(quickFilters.has('unsynced') && !SYNC_META[ticket.syncState]) return false;
  return true;
}
function renderQuickFilters(){
  document.querySelectorAll('[data-quick-filter]').forEach(function(button){
    const name=button.dataset.quickFilter;
    const capability=quickFilterCapability(name);
    const preferred=quickFilters.has(name);
    const disabled=capability !== 'available';
    const unavailableReason=name === 'mine' ? STRINGS.quickMyIssuesUnavailable : STRINGS.quickOpenUnavailable;
    const preferenceReason=name === 'mine' ? STRINGS.quickMyIssuesUnavailableSelected : STRINGS.quickOpenUnavailableSelected;
    const description=capability === 'loading'
      ? STRINGS.quickFilterCapabilityLoading
      : capability === 'unavailable'
        ? (preferred ? preferenceReason : unavailableReason)
        : '';
    button.disabled=disabled;
    button.title=description;
    button.setAttribute('data-capability',capability);
    button.setAttribute('data-preferred',String(preferred));
    button.setAttribute('aria-pressed',String(preferred && !disabled));
    if(description) button.setAttribute('aria-label',(button.textContent || name)+'. '+description);
    else button.removeAttribute('aria-label');
  });
}

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
  else if(action === 'sync') req('ticket.syncSelected',{ticketId:ticketId});
  else if(action === 'refresh') req('dashboard.refresh');
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
  const status = state.settings && state.settings.showStatus !== false && ticket.statusName ? '<span class="ticket-attribute" title="'+esc(STRINGS.sortStatus)+'">'+esc(ticket.statusName)+'</span>' : '';
  const due = dueBadge(ticket);
  const tracker = state.settings && state.settings.showTracker !== false && ticket.trackerName ? '<span class="ticket-attribute" title="'+esc(STRINGS.sortTracker)+'">'+esc(ticket.trackerName)+'</span>' : '';
  const priority = state.settings && state.settings.showPriority !== false && ticket.priorityName ? '<span class="ticket-attribute" title="'+esc(STRINGS.sortPriority)+'">'+esc(ticket.priorityName)+'</span>' : '';
  const actionItems = [['open',STRINGS.openInEditor],['comment',STRINGS.addCommentAction],['browser',STRINGS.openInBrowser],['child',STRINGS.createChildTicket],['sync',STRINGS.syncToRedmine]].map(function(item){ return '<button type="button" role="menuitem" data-ticket-action="'+item[0]+'" data-ticket="'+ticket.id+'">'+actionIcon(item[0])+esc(item[1])+'</button>'; }).join('');
  const actionMenu = '<span class="ticket-actions"><button class="ticket-action-btn" type="button" data-ticket-action-menu="'+ticket.id+'" aria-haspopup="menu" aria-expanded="false" aria-controls="ticket-action-menu-'+ticket.id+'" aria-label="'+esc(STRINGS.ticketActionMenu)+'" title="'+esc(STRINGS.ticketActionMenu)+'"><span class="icon-more" aria-hidden="true">•••</span></button><span class="ticket-action-menu hidden" id="ticket-action-menu-'+ticket.id+'" role="menu">'+actionItems+'</span></span>';
  const expand = hasChildren ? '<button class="expand-btn" type="button" data-expand="'+ticket.id+'" aria-expanded="'+expanded+'" aria-label="'+esc(expanded ? STRINGS.collapseTitle : STRINGS.expandTitle)+'" title="'+esc(expanded ? STRINGS.collapseTitle : STRINGS.expandTitle)+'"><span class="expand-icon '+(expanded?'expanded':'collapsed')+'" aria-hidden="true"></span></button>' : '<span class="expand-placeholder" aria-hidden="true"></span>';
  const assignee = state.settings.showAssignee !== false && hasAssignee(ticket.assigneeName) ? '<span class="ticket-attribute ticket-assignee" title="'+esc(STRINGS.sortAssignee)+'">'+esc(ticket.assigneeName)+'</span>' : '';
  return '<div class="ticket-row'+(ticket.level > 0 ? ' child-row' : '')+(selected ? ' selected' : '')+'" data-id="'+ticket.id+'" role="listitem" aria-current="'+selected+'" tabindex="0" data-level="'+esc(ticket.level || 0)+'">'+expand+'<div class="ticket-row-content"><div class="ticket-row-main"><span class="ticket-id">#'+ticket.id+'</span><span class="ticket-subject" title="'+esc(ticket.subject)+'">'+esc(ticket.subject)+'</span></div><div class="ticket-row-meta">'+status+tracker+priority+assignee+due+sync+'</div></div>'+actionMenu+'</div>';
}
function isTicketActionTarget(target){ return isElement(target) && !!target.closest('.ticket-action-btn,.ticket-action-menu,.expand-btn'); }
function renderTickets(){
  if(!state) return;
  renderQuickFilters();
  const list = document.getElementById('ticket-list');
  const focus=captureFocus(list);
  list.setAttribute('aria-busy',String(state.loading.tickets));
  const more = document.getElementById('load-more-row');
  const count = document.getElementById('ticket-count');
  count.textContent = '';
  if(state.errors.tickets && !state.loading.tickets){
    list.innerHTML='<div class="state-msg error-msg" role="alert"><strong>'+esc(STRINGS.errorLabel)+'</strong><p>'+esc(state.errors.tickets)+'</p><button id="retry-tickets" class="btn btn-secondary" type="button">'+esc(STRINGS.retry)+'</button></div>';
    list.querySelector('#retry-tickets').addEventListener('click',function(){ if(!state.selectedProject && searchQuery) req('tickets.searchAllProjects',{query:searchInput.value}); else req('dashboard.refresh'); });
    more.classList.add('hidden'); updateSyncButtonStates(); return;
  }
  if(!state.selectedProject && !state.tickets.length && !state.loading.tickets && !searchQuery){ list.innerHTML='<div class="state-msg">'+STRINGS.noProjectSelected+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  if(state.loading.tickets){ list.innerHTML='<div class="state-msg loading-state" role="status">'+esc(STRINGS.loadingTickets)+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  const hasActiveQuickFilter=hasEffectiveQuickFilters();
  const tickets = (searchQuery || hasActiveQuickFilter ? flattenAll(state.tickets) : flattenVisible(state.tickets)).filter(function(ticket){ return matchesSearch(ticket) && matchesQuickFilters(ticket); });
  count.textContent = STRINGS.shownLoadedTotal.replace('{0}',String(tickets.length)).replace('{1}',String(state.loadedTicketCount)).replace('{2}',String(state.totalTicketCount));
  list.innerHTML = tickets.length ? tickets.map(renderTicketRow).join('') : '<div class="state-msg" role="status"><strong>'+esc(STRINGS.noTicketsFound)+'</strong><p>'+esc(STRINGS.searchEmptyHint)+'</p></div>';
  if(state.loadedTicketCount < state.totalTicketCount){ more.classList.remove('hidden'); more.textContent=STRINGS.loadMore+' ('+state.loadedTicketCount+' / '+state.totalTicketCount+')'; } else more.classList.add('hidden');
  list.querySelectorAll('.ticket-row').forEach(function(row){
    row.style.paddingLeft=(12 + Math.max(0,Number(row.dataset.level) || 0) * 14)+'px';
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
function renderSelect(name,value,options,label,disabled,allowBlank){
  const current=value || ''; const list=options || []; const disabledAttribute=disabled ? ' disabled' : '';
  const blank=allowBlank ? '<option value=""'+(!current?' selected':'')+'>'+esc(STRINGS.assigneeUnassigned)+'</option>' : '';
  const currentOption=current && !list.some(function(option){ return option.name === current; }) ? '<option value="'+esc(current)+'" selected>'+esc(current)+'</option>' : '';
  const optionsHtml=list.map(function(option){ return '<option value="'+esc(option.name)+'"'+(option.name===current?' selected':'')+'>'+esc(option.name)+'</option>'; }).join('');
  return '<label class="detail-field"><span>'+esc(label)+'</span><select class="detail-select" data-metadata-field="'+name+'"'+disabledAttribute+'>'+blank+currentOption+optionsHtml+'</select></label>';
}
function editOptionsFor(ticketId){ const options=state && state.editOptions; return options && options.ticketId === ticketId ? options : null; }
function metadataOptionsReady(){ return !!(state && state.metadataOptions && state.metadataOptions.trackers.length && state.metadataOptions.priorities.length && state.metadataOptions.statuses.length); }
function ticketMetadataValues(ticket){
  return {tracker:ticket.trackerName || '',priority:ticket.priorityName || '',status:ticket.statusName || '',assignee:ticket.assigneeName || '',start_date:ticket.startDate || '',due_date:ticket.dueDate || ''};
}
function metadataPatch(){
  const patch={};
  if(metadataEdit) Object.keys(metadataEdit.values).forEach(function(field){ if(metadataEdit.values[field] !== metadataEdit.original[field]) patch[field]=metadataEdit.values[field]; });
  return patch;
}
function renderTicketDetailPanel(ticket){
  if(renderedDetailTicketId !== ticket.id){ renderedDetailTicketId=ticket.id; metadataExpanded=metadataEdit?.ticketId === ticket.id; ticketDetailExpanded=false; }
  const card=document.getElementById('ticket-detail-card');
  const options=editOptionsFor(ticket.id);
  const ready=!!options && !options.loading && !options.error;
  const editing=metadataEdit?.ticketId === ticket.id;
  const pending=editing && !!metadataEdit.requestId;
  const values=editing ? metadataEdit.values : ticketMetadataValues(ticket);
  const canEdit=ready || (!options && metadataOptionsReady());
  const lists=options || state.metadataOptions;
  const fields=[['tracker',STRINGS.sortTracker],['priority',STRINGS.sortPriority],['status',STRINGS.sortStatus],['assignee',STRINGS.sortAssignee],['start_date',STRINGS.startDate],['due_date',STRINGS.dueDateLabel]];
  card.classList.remove('hidden'); card.removeAttribute('aria-busy');
  const description=ticket.description ? '<div class="detail-description'+(ticketDetailExpanded ? '' : ' detail-description-collapsed')+'">'+esc(ticket.description)+'</div>' : '<p class="detail-hint">'+esc(STRINGS.noDescription)+'</p>';
  const warning=['Draft','Dirty','Queued','Syncing','Conflict','Failed','RecoveryPending','CommitUnknown'].includes(ticket.syncState) ? '<p class="detail-description-warning" role="note">'+esc(STRINGS.descriptionUnsyncedWarning)+'</p>' : '';
  const parent=ticket.parentId ? '<div class="detail-parent">#'+ticket.parentId+(ticket.parentSubject ? ' '+esc(ticket.parentSubject) : '')+'</div>' : '';
  const statusHint=options?.statusFallback ? '<p class="detail-hint">'+esc(STRINGS.statusFallbackHint)+'</p>' : '';
  const loadingHint=options?.loading ? '<p class="detail-hint">'+esc(STRINGS.loadingEditOptions)+'</p>' : '';
  const errorHint=options?.error ? '<p class="detail-hint" role="alert">'+esc(options.error)+'</p>' : '';
  const metadataFields=editing
    ? renderSelect('tracker',values.tracker,lists.trackers,STRINGS.sortTracker,pending || !canEdit,false)
      +renderSelect('priority',values.priority,lists.priorities,STRINGS.sortPriority,pending || !canEdit,false)
      +renderSelect('status',values.status,lists.statuses,STRINGS.sortStatus,pending || !canEdit,false)
      +renderSelect('assignee',values.assignee,options?.assignees || [],STRINGS.sortAssignee,pending || !ready,true)
      +fields.slice(4).map(function(field){ return '<label class="detail-field"><span>'+esc(field[1])+'</span><input class="detail-input" type="date" data-metadata-field="'+field[0]+'" value="'+esc(values[field[0]])+'"'+(pending?' disabled':'')+'></label>'; }).join('')
    : fields.map(function(field){ const value=values[field[0]] || (field[0] === 'assignee' ? STRINGS.assigneeUnassigned : STRINGS.notSet); return '<div class="detail-meta"><span>'+esc(field[1])+'</span><strong>'+esc(value)+'</strong></div>'; }).join('');
  const metadata='<details class="detail-section detail-metadata" id="metadata-details"'+(metadataExpanded || editing?' open':'')+'><summary id="metadata-heading">'+esc(STRINGS.ticketMetadata)+'<span class="metadata-summary">'+esc(ticket.statusName || '')+(ticket.priorityName?' · '+esc(ticket.priorityName):'')+'</span></summary><div class="detail-section-head">'+(editing ? '' : '<button id="metadata-edit-btn" class="btn btn-secondary" type="button"'+(!canEdit?' disabled':'')+'>'+esc(STRINGS.editMetadata)+'</button>')+'</div><div class="detail-metadata-grid">'+metadataFields+'</div>'+loadingHint+errorHint+statusHint+(editing ? '<p class="detail-hint">'+esc(STRINGS.metadataApplyHint)+'</p><div class="metadata-actions"><button id="metadata-apply-btn" class="btn btn-primary" type="button"'+(pending || !canEdit || !Object.keys(metadataPatch()).length?' disabled':'')+'>'+esc(pending ? STRINGS.applyingMetadata : STRINGS.applyMetadata)+'</button><button id="metadata-cancel-btn" class="btn btn-secondary" type="button"'+(pending?' disabled':'')+'>'+esc(STRINGS.cancelAction)+'</button></div>' : '')+'</details>';
  const assigneeAvatar=hasAssignee(ticket.assigneeName) ? avatar(ticket.assigneeName,'detail-avatar') : '';
  card.innerHTML='<div class="detail-head"><div class="detail-title"><span class="ticket-id">#'+ticket.id+'</span><span>'+esc(ticket.subject)+'</span></div><div class="detail-header-actions"><button class="btn btn-secondary detail-toggle" id="detail-cancel-btn" type="button" title="'+esc(STRINGS.dismissDetail)+'" aria-label="'+esc(STRINGS.dismissDetail)+'">'+actionIcon('cancel')+'</button></div></div>'
    +'<div class="detail-project">'+esc(ticket.projectName || STRINGS.projectNone)+assigneeAvatar+'</div>'+parent
    +'<div class="detail-sync-line"><span class="sr-only">'+esc(STRINGS.editingState)+'</span><span id="detail-sync-state" role="status" aria-live="polite"></span></div>'
    +'<div class="detail-actions"><button class="btn btn-primary" id="detail-open-btn" type="button" title="'+esc(STRINGS.openTicketTooltip)+'">'+actionIcon('open')+'<span>'+esc(STRINGS.openInEditor)+'</span></button><button class="btn btn-secondary detail-sync-button" id="detail-sync-btn" type="button" title="'+esc(STRINGS.syncTicketTooltip)+'">'+actionIcon('sync')+'<span>'+esc(STRINGS.syncToRedmine)+'</span></button><button class="btn btn-secondary detail-icon-button" id="detail-comment-btn" type="button" title="'+esc(STRINGS.addCommentAction)+'" aria-label="'+esc(STRINGS.addCommentAction)+'">'+actionIcon('comment')+'</button><span class="ticket-actions detail-more"><button class="ticket-action-btn" id="detail-more-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="detail-action-menu" aria-label="'+esc(STRINGS.ticketActionMenu)+'">•••</button><span class="ticket-action-menu hidden" id="detail-action-menu" role="menu"><button role="menuitem" id="detail-browser-btn" data-detail-action="browser" type="button">'+actionIcon('browser')+esc(STRINGS.openInBrowser)+'</button><button role="menuitem" data-detail-action="child" type="button">'+actionIcon('child')+esc(STRINGS.createChildTicket)+'</button></span></span></div>'
    +'<div class="detail-tabs" role="tablist" aria-label="'+esc(STRINGS.tabTickets)+'"><button id="detail-tab-overview" role="tab" aria-selected="'+(detailTab === 'overview')+'" aria-controls="detail-overview" tabindex="'+(detailTab === 'overview'?'0':'-1')+'" type="button">'+esc(STRINGS.overview)+'</button><button id="detail-tab-comments" role="tab" aria-selected="'+(detailTab === 'comments')+'" aria-controls="detail-comments" tabindex="'+(detailTab === 'comments'?'0':'-1')+'" type="button">'+esc(STRINGS.tabComments)+' <span class="tab-badge">'+(state.comments.ticketId === ticket.id ? state.comments.items.length : 0)+'</span></button></div>'
    +'<div id="detail-overview" role="tabpanel" aria-labelledby="detail-tab-overview"'+(detailTab === 'overview'?'':' hidden')+'>'+metadata+'<section class="detail-section" aria-labelledby="description-heading"><div class="detail-section-head"><h3 id="description-heading">'+esc(STRINGS.remoteDescription)+'</h3><button class="btn btn-secondary detail-toggle" id="ticket-detail-toggle" type="button" title="'+esc(ticketDetailExpanded?STRINGS.closeDetail:STRINGS.openDetail)+'" aria-label="'+esc(ticketDetailExpanded?STRINGS.closeDetail:STRINGS.openDetail)+'" aria-expanded="'+ticketDetailExpanded+'">'+(ticketDetailExpanded?'⌃':'⌄')+'</button></div>'+warning+description+'</section></div><div id="detail-comments" role="tabpanel" aria-labelledby="detail-tab-comments"'+(detailTab === 'comments'?'':' hidden')+'><div id="comments-list"></div></div>';
  card.querySelector('#metadata-details').addEventListener('toggle',function(){ metadataExpanded=this.open; });
  card.querySelector('#ticket-detail-toggle').addEventListener('click',function(){ ticketDetailExpanded=!ticketDetailExpanded; renderTicketDetail(); document.getElementById('ticket-detail-toggle').focus(); });
  card.querySelector('#detail-cancel-btn').addEventListener('click',function(){ req('ticket.cancelDetail'); });
  card.querySelector('#detail-open-btn').addEventListener('click',function(){ req('ticket.openEditor',{ticketId:ticket.id}); });
  card.querySelector('#detail-comment-btn').addEventListener('click',function(){ req('comment.add',{ticketId:ticket.id}); });
  card.querySelector('#detail-sync-btn').addEventListener('click',function(){ req('ticket.syncSelected',{ticketId:ticket.id}); });
  card.querySelector('#detail-more-btn').addEventListener('click',function(event){
    event.stopPropagation(); const menu=card.querySelector('#detail-action-menu'); const opening=menu.classList.contains('hidden'); closeTicketActionMenus();
    if(!opening) return; menu.classList.remove('hidden'); activeTicketActionMenuId='detail-action-menu';
    this.setAttribute('aria-expanded','true'); const rect=this.getBoundingClientRect(); const bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.right-bounds.width,window.innerWidth-bounds.width-8))+'px'; menu.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-bounds.height-8))+'px';
    activeTicketActionAnchorTop=rect.top; menu.querySelector('[role="menuitem"]')?.focus();
  });
  card.querySelectorAll('[data-detail-action]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); runTicketAction(button.dataset.detailAction,ticket.id); }); });
  const switchDetailTab=function(name,focus){ detailTab=name; persistViewState(); card.querySelectorAll('.detail-tabs [role="tab"]').forEach(function(tab){ const selected=tab.id === 'detail-tab-'+name; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex=selected?0:-1; }); card.querySelector('#detail-overview').hidden=name !== 'overview'; card.querySelector('#detail-comments').hidden=name !== 'comments'; if(name === 'comments') updateCommentExpandButtons(); if(focus) card.querySelector('#detail-tab-'+name).focus(); };
  card.querySelector('#detail-tab-overview').addEventListener('click',function(){ switchDetailTab('overview',false); });
  card.querySelector('#detail-tab-comments').addEventListener('click',function(){ switchDetailTab('comments',false); });
  card.querySelector('.detail-tabs').addEventListener('keydown',function(event){ const next=event.key === 'ArrowRight' || event.key === 'End' ? 'comments' : event.key === 'ArrowLeft' || event.key === 'Home' ? 'overview' : null; if(next){ switchDetailTab(next,true); event.preventDefault(); } });
  card.querySelector('#metadata-edit-btn')?.addEventListener('click',function(){ const original=ticketMetadataValues(ticket); metadataExpanded=true; metadataEdit={ticketId:ticket.id,original:original,values:Object.assign({},original),requestId:null}; renderTicketDetail(); card.querySelector('[data-metadata-field]')?.focus(); });
  card.querySelector('#metadata-cancel-btn')?.addEventListener('click',function(){ metadataEdit=null; renderTicketDetail(); document.getElementById('metadata-edit-btn')?.focus(); });
  card.querySelector('#metadata-apply-btn')?.addEventListener('click',function(){
    if(!metadataEdit || metadataEdit.requestId) return;
    const patch=metadataPatch();
    if(!Object.keys(patch).length) return;
    metadataEdit.requestId=req('ticket.metadata.update',{ticketId:ticket.id,patch:patch});
    renderTicketDetail();
  });
  card.querySelectorAll('[data-metadata-field]').forEach(function(input){
    const stage=function(){
      if(!metadataEdit || metadataEdit.requestId) return;
      metadataEdit.values[input.dataset.metadataField]=input.value;
      document.getElementById('metadata-apply-btn').disabled=!canEdit || !Object.keys(metadataPatch()).length;
      updateSyncButtonStates();
    };
    input.addEventListener('input',stage); input.addEventListener('change',stage);
  });
  updateSyncButtonStates();
  renderComments();
}
function renderComposerPanel(panel){
  const nextComposerDraftKey=[panel.mode,panel.projectId,panel.mode === 'childTicket' ? panel.parentTicketId : ''].join(':'); if(composerDraftKey !== nextComposerDraftKey){ composerDraftKey=nextComposerDraftKey; composerDraftValues=null; }
  const card=document.getElementById('ticket-detail-card'); card.classList.remove('hidden');
  const title=panel.mode === 'childTicket' ? STRINGS.createChildTicketTitle : STRINGS.createNewTicketTitle; const parent=panel.mode === 'childTicket' ? '<div class="work-panel-subtitle">'+esc(STRINGS.parentLabel)+': #'+panel.parentTicketId+' '+esc(panel.parentSubject || '')+'</div>' : ''; const error=panel.error ? '<div class="composer-error" role="alert">'+esc(panel.error)+'</div>' : '';
  card.setAttribute('aria-busy',String(panel.loading));
  if(panel.loading){ card.innerHTML='<div class="work-panel-head"><div class="work-panel-title">'+title+'</div>'+parent+'</div><div class="composer-loading">'+STRINGS.loadingTrackers+'</div>'; return; }
  const values=Object.assign({},panel.values || {},composerDraftValues || {}); const options=function(items,key){ return (items || []).map(function(item){ return '<option value="'+esc(item.name)+'"'+(item.name===values[key]?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); }; const canCreate=!!(values.tracker && values.priority);
  card.innerHTML='<div class="work-panel-head"><div class="work-panel-title">'+title+'</div><div class="work-panel-subtitle">'+esc(panel.projectName || (STRINGS.projectLabel+' #'+panel.projectId))+'</div>'+parent+'</div>'+error+'<div class="composer-actions"><button class="btn btn-secondary" id="work-cancel" type="button">'+STRINGS.cancelAction+'</button><button class="btn btn-primary" id="work-create" type="button"'+(canCreate?'':' disabled')+'>'+STRINGS.createDraft+'</button><button class="btn btn-secondary" id="work-sync-new-ticket" type="button">'+actionIcon('sync')+esc(STRINGS.syncToRedmine)+'</button></div><div class="composer-grid"><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortTracker)+' <span class="composer-required">*</span></span><select class="detail-select" id="work-tracker" required><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.trackers,'tracker')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortPriority)+' <span class="composer-required">*</span></span><select class="detail-select" id="work-priority" required><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.priorities,'priority')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortAssignee)+'</span><select class="detail-select" id="work-assignee"><option value="">'+STRINGS.assigneeUnassigned+'</option>'+options(panel.assignees,'assigned_to')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.sortStatus)+'</span><select class="detail-select" id="work-status"><option value="">'+esc(STRINGS.selectOption)+'</option>'+options(panel.statuses,'status')+'</select></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.startDate)+'</span><input class="detail-input" id="work-start-date" type="date" value="'+esc(values.start_date || '')+'"></label><label class="detail-field composer-detail-field"><span>'+esc(STRINGS.dueDateLabel)+'</span><input class="detail-input" id="work-due-date" type="date" value="'+esc(values.due_date || '')+'"></label><label class="detail-field composer-detail-field composer-description-field"><span>'+esc(STRINGS.descriptionLabel)+'</span><textarea class="detail-input composer-textarea" id="work-description">'+esc(values.description || '')+'</textarea></label></div>';
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
  if(!panel){ composerDraftKey=null; composerDraftValues=null; if(!state.selectedTicket){ renderedDetailTicketId=null; metadataExpanded=false; ticketDetailExpanded=false; card.classList.add('hidden'); card.innerHTML=''; return; } renderTicketDetailPanel(state.selectedTicket); return; }
  if(panel.mode === 'detail'){ composerDraftKey=null; composerDraftValues=null; if(state.selectedTicket && state.selectedTicket.id === panel.ticketId) renderTicketDetailPanel(state.selectedTicket); else { card.classList.add('hidden'); card.innerHTML=''; } return; }
  renderComposerPanel(panel);
}

// ── Filter chips ───────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const filters=state.settings.filters;
  const count=Number(!!filters.subjectQuery)+(filters.assigneeIds || []).length+(filters.statusIds || []).length+(filters.priorityIds || []).length+(filters.trackerIds || []).length+Number(filters.includeUnassigned === false);
  const badge=document.getElementById('advanced-filter-count'); badge.textContent=String(count); badge.classList.toggle('hidden',count === 0);
  filterTrigger.setAttribute('aria-label',STRINGS.advancedFilters+(count ? ' '+count : ''));
  const element=document.getElementById('filter-chips');
  if(element) element.textContent=count ? STRINGS.advancedFilters+' '+count : '';
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
  if(item?.requiresReview === true) return UNSYNCED_BADGE_META.recovery_pending;
  const lifecycle=item && typeof item.lifecycle === 'string' ? item.lifecycle : 'queued';
  return UNSYNCED_BADGE_META[lifecycle] || UNSYNCED_BADGE_META.queued;
}
function unsyncedKindLabel(kind){ return kind === 'ticket' ? STRINGS.unsyncedKindTicket : kind === 'newTicket' ? STRINGS.unsyncedKindNewTicket : kind === 'comment' ? STRINGS.unsyncedKindComment : STRINGS.unsyncedKindFile; }
function renderUnsynced(){
  if(!state) return; const items=state.unsynced.items || []; const count=state.unsynced.totalCount || 0; const tabBadge=document.getElementById('unsynced-badge'); tabBadge.textContent=String(count); tabBadge.setAttribute('aria-label',String(count)); tabBadge.classList.toggle('hidden',count === 0);
  const countLabel=document.getElementById('unsynced-count-label'); countLabel.textContent=(STRINGS.unsyncedCountLabel || STRINGS.tabUnsynced).replace('{0}',String(count)); const syncAll=document.getElementById('sync-all-btn'); const requiresReview=items.some(function(item){ return resolveUnsyncedBadge(item).kind === 'review'; }); syncAll.classList.toggle('hidden',count === 0 || requiresReview); syncAll.onclick=function(){ req('unsynced.syncAll'); };
  const queued=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'queued'; }).length; const review=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'review'; }).length; const conflict=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'conflict'; }).length; const failed=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'failed'; }).length; const summary=document.getElementById('unsynced-summary'); summary.innerHTML=(review ? '<span class="summary-badge">'+esc(STRINGS.syncReviewRequired || STRINGS.syncFailed)+' <strong>'+review+'</strong></span>' : '')+(queued ? '<span class="summary-badge">'+esc(STRINGS.syncQueued)+' <strong>'+queued+'</strong></span>' : '')+(conflict ? '<span class="summary-badge">'+esc(STRINGS.syncConflict)+' <strong>'+conflict+'</strong></span>' : '')+(failed ? '<span class="summary-badge">'+esc(STRINGS.syncFailed)+' <strong>'+failed+'</strong></span>' : '');
  const list=document.getElementById('unsynced-list'); if(!items.length){ list.innerHTML='<div class="state-msg">'+STRINGS.noUnsyncedChanges+'</div>'; updateSyncButtonStates(); return; }
  const ordered=items.slice().sort(function(a,b){ return Number(resolveUnsyncedBadge(b).kind === 'review')-Number(resolveUnsyncedBadge(a).kind === 'review'); });
  list.innerHTML=ordered.map(function(item,index){ const status=resolveUnsyncedBadge(item); const group=index === 0 || resolveUnsyncedBadge(ordered[index-1]).kind === 'review' && status.kind !== 'review' ? '<h3 class="unsynced-group-title">'+esc(status.kind === 'review' ? STRINGS.syncReviewRequired : STRINGS.tabUnsynced)+'</h3>' : ''; const open=item.documentUri ? '<button class="btn btn-secondary" type="button" data-uri="'+esc(item.documentUri)+'">'+actionIcon('open')+esc(STRINGS.openInEditor)+'</button>' : ''; const discardsLaterChanges=item.discardMode === 'nextIntent'; const discardLabel=discardsLaterChanges ? STRINGS.discardLaterChangesAction : STRINGS.discardAction; const discardTitle=discardsLaterChanges ? STRINGS.discardLaterChangesTitle : STRINGS.discardTitle; const discard=item.discardMode === 'none' || item.canDiscard === false ? '<button class="btn btn-secondary" type="button" disabled>'+esc(discardLabel)+'</button>' : '<button class="btn btn-secondary" type="button" data-discard-key="'+safeJson(item.key)+'" title="'+esc(discardTitle)+'">'+esc(discardLabel)+'</button>'; const requiresReview=status.requiresReview === true; const actionLabel=requiresReview ? STRINGS.resolveRecovery : STRINGS.syncToRedmine; const actionTitle=requiresReview ? ' title="'+esc(STRINGS.resolveRecoveryTooltip)+'"' : ''; const sync=item.canSync === false ? '<button class="btn btn-secondary" type="button" disabled>'+actionIcon('sync')+esc(actionLabel)+'</button>' : '<button class="btn btn-secondary" type="button" data-sync-key="'+safeJson(item.key)+'"'+actionTitle+'>'+actionIcon('sync')+esc(actionLabel)+'</button>'; const detail=item.detail || ''; return group+'<div class="unsynced-card" role="listitem"><span class="unsynced-kind-label">'+esc(unsyncedKindLabel(item.key.kind))+'</span><div class="unsynced-body"><div class="unsynced-label">'+esc(item.label)+'</div>'+(detail ? '<div class="unsynced-detail">'+esc(detail)+'</div>' : '')+'</div><div class="unsynced-state">'+badge(status.label,status.cls,status.icon)+'</div><div class="unsynced-actions">'+open+discard+sync+'</div></div>'; }).join('');
  list.querySelectorAll('[data-uri]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.openLocalFile',{documentUri:button.dataset.uri}); }); });
  list.querySelectorAll('[data-discard-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.discardOne',{key:JSON.parse(button.getAttribute('data-discard-key'))}); } catch {} }); });
  list.querySelectorAll('[data-sync-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.syncOne',{key:JSON.parse(button.getAttribute('data-sync-key'))}); } catch {} }); });
  updateSyncButtonStates();
}

// ── Comments ───────────────────────────────────────────────────────────────
function updateCommentExpandButtons(){
  document.querySelectorAll('.comment-card').forEach(function(card){
    if(!card.getBoundingClientRect().width) return;
    const body=card.querySelector('.comment-body-clamped');
    const button=card.querySelector('.comment-expand');
    if(body && button) button.classList.toggle('hidden',body.scrollHeight <= body.clientHeight+1);
  });
}
window.addEventListener('resize',updateCommentExpandButtons);
function renderComments(){
  if(!state) return; const comments=state.comments; const list=document.getElementById('comments-list'); if(!list) return; const ticketId=state.selectedTicketId; list.setAttribute('aria-busy',String(comments.loading));
  if(ticketId === undefined){ list.innerHTML='<div class="state-msg">'+STRINGS.noTicketSelected+'</div>'; return; }
  if(comments.ticketId !== ticketId){ list.innerHTML='<div class="state-msg">'+esc(STRINGS.loadingComments)+'</div>'; return; }
  const header='<div class="comments-header"><span class="comments-header-label">'+esc(STRINGS.commentsForTicket)+' #'+ticketId+'</span><div class="comments-header-actions"><button class="btn btn-secondary" id="add-comment-btn" type="button">'+actionIcon('comment')+esc(STRINGS.addCommentAction)+'</button><button class="btn btn-secondary detail-icon-button" id="reload-comments-btn" type="button" title="'+esc(STRINGS.reloadComments)+'" aria-label="'+esc(STRINGS.reloadComments)+'">'+actionIcon('refresh')+'</button></div></div>';
  let content='';
  if(comments.loading) content='<div class="state-msg">'+STRINGS.loadingComments+'</div>';
  else if(comments.error) content='<div class="state-msg error-msg">'+esc(comments.error)+'</div>';
  else if(!comments.items.length) content='<div class="state-msg">'+STRINGS.noComments+'</div>';
  else content='<div class="comment-list" role="list">'+comments.items.map(function(cm,index){
    const key=String(ticketId)+':'+String(cm.id || index);
    const expanded=expandedComments.has(key);
    const unsynced=cm.hasUnsyncedEdit ? badge(STRINGS.unsyncedEditBadge,'sync-dirty','•') : '';
    const syncBtn=cm.syncKey?'<button class="btn btn-secondary" type="button" data-sync-comment-key="'+esc(JSON.stringify(cm.syncKey))+'">'+actionIcon('sync')+esc(STRINGS.syncToRedmine)+'</button>':'';
    const editBtn=cm.id&&cm.editableByCurrentUser?'<button class="btn btn-secondary" type="button" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="'+esc(STRINGS.openInEditor)+'">'+actionIcon('open')+esc(STRINGS.openInEditor)+'</button>':'';
    const browserBtn=cm.id?'<button class="btn btn-secondary" type="button" data-open-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="'+esc(STRINGS.openInBrowser)+'">'+actionIcon('browser')+esc(STRINGS.openInBrowser)+'</button>':'';
    const journalId=cm.id?'<span class="comment-id">#'+cm.id+'</span>':'';
    const date=cm.updatedAt?'<time class="comment-date" title="'+esc(cm.updatedAt)+'">'+esc(cm.updatedAt.substring(0,16).replace('T',' '))+'</time>':'';
    const expand=cm.body?'<button class="comment-expand" type="button" data-expand-comment="'+esc(key)+'" aria-expanded="'+expanded+'">'+esc(expanded?STRINGS.collapseTitle:STRINGS.expandTitle)+'</button>':'';
    return '<article class="comment-card" role="listitem"><div class="comment-header"><div class="comment-meta"><span class="comment-author">'+esc(cm.authorName)+'</span>'+date+journalId+'</div><div class="comment-status">'+unsynced+'</div></div><div class="comment-body'+(expanded?'':' comment-body-clamped')+'">'+esc(cm.body)+'</div><div class="comment-actions">'+expand+browserBtn+editBtn+syncBtn+'</div></article>';
  }).join('')+'</div>';
  list.innerHTML=header+content; updateCommentExpandButtons(); list.querySelector('#add-comment-btn')?.addEventListener('click',function(){ req('comment.add',{ticketId:ticketId}); }); list.querySelector('#reload-comments-btn')?.addEventListener('click',function(){ req('comment.reload',{ticketId:ticketId}); });
  list.querySelectorAll('[data-edit-comment]').forEach(function(button){ button.addEventListener('click',function(){ req('comment.edit',{ticketId:Number(button.dataset.ticket),commentId:Number(button.dataset.editComment)}); }); }); list.querySelectorAll('[data-open-comment]').forEach(function(button){ button.addEventListener('click',function(){ req('comment.openBrowser',{ticketId:Number(button.dataset.ticket),commentId:Number(button.dataset.openComment)}); }); });
  list.querySelectorAll('[data-sync-comment-key]').forEach(function(btn){ btn.addEventListener('click',function(){ try { req('unsynced.syncOne',{key:JSON.parse(btn.getAttribute('data-sync-comment-key'))}); } catch {} }); });
  list.querySelectorAll('[data-expand-comment]').forEach(function(button){ button.addEventListener('click',function(){ const key=button.dataset.expandComment; if(expandedComments.has(key)) expandedComments.delete(key); else expandedComments.add(key); renderComments(); list.querySelector('[data-expand-comment="'+CSS.escape(key)+'"]')?.focus(); }); });
  updateSyncButtonStates();
}

// ── Settings ──────────────────────────────────────────────────────────────
const sortFields=function(){ return [['',STRINGS.sortDefaultOption],['priority',STRINGS.sortPriority],['status',STRINGS.sortStatus],['tracker',STRINGS.sortTracker],['assignee',STRINGS.sortAssignee]]; };
function selectOptions(options,current){ return options.map(function(option){ return '<option value="'+esc(option[0])+'"'+(option[0] === current ? ' selected' : '')+'>'+esc(option[1])+'</option>'; }).join(''); }
function dueToggles(rule){ return [['set-dd-overdue','showOverdue',STRINGS.dueOverdue],['set-dd-1d','showWithin1Day',STRINGS.due1Day],['set-dd-3d','showWithin3Days',STRINGS.due3Days],['set-dd-7d','showWithin7Days',STRINGS.due7Days]].map(function(item){ return '<label class="setting-row"><span class="setting-label">'+esc(item[2])+'</span><input class="setting-check" type="checkbox" id="'+item[0]+'"'+(rule[item[1]]?' checked':'')+'></label>'; }).join(''); }

function renderSettingsBase(){
  if(!state) return;
  const settings=state.settings;
  const defaults=settings.editorDefaults || {};
  const element=document.getElementById('settings-content');
  const hadCategories=!!element.querySelector('.settings-category');
  const openCategories=new Set(Array.from(element.querySelectorAll('.settings-category[open]')).map(function(category){ return category.dataset.category; }));
  const focused=document.activeElement && element.contains(document.activeElement) && document.activeElement.id ? {id:document.activeElement.id,value:document.activeElement.value} : null;
  element.innerHTML='<section class="settings-section" data-section="connection"><h3>'+STRINGS.sectionConnection+'</h3>'+
    '<label class="setting-row" for="set-base-url"><span class="setting-label">'+STRINGS.redmineUrlLabel+'</span><input class="setting-input" id="set-base-url" type="url" value="'+esc(settings.baseUrl)+'" autocomplete="url"></label>'+
    '<label class="setting-row" for="set-default-project"><span class="setting-label">'+STRINGS.defaultProjectLabel+'</span><input class="setting-input" id="set-default-project" type="text" value="'+esc(settings.defaultProjectId)+'"></label>'+
    '<label class="setting-row" for="set-request-timeout"><span class="setting-label">'+STRINGS.requestTimeoutLabel+'</span><input class="setting-input setting-input-num" id="set-request-timeout" type="number" min="1" step="1" value="'+esc(settings.requestTimeoutMs)+'"></label>'+
    '<label class="setting-row" for="set-ignore-ssl"><span class="setting-label">'+STRINGS.ignoreSSLErrorsLabel+'</span><input class="setting-check" id="set-ignore-ssl" type="checkbox"'+(settings.ignoreSSLErrors?' checked':'')+'></label><p class="setting-warning" role="note">'+esc(STRINGS.ignoreSSLErrorsWarning)+'</p>'+
    '<div class="setting-row"><span class="setting-label">'+STRINGS.sectionApiKey+'</span><span class="setting-value apikey-status apikey-status-'+(settings.apiKeyStatus === 'set'?'set':'notset')+'">'+(settings.apiKeyStatus === 'set'?STRINGS.apiKeyStatusSet:STRINGS.apiKeyStatusNotSet)+'</span></div><div class="apikey-actions"><button class="btn btn-secondary" id="set-apikey-btn" type="button">'+(settings.apiKeyStatus === 'set'?STRINGS.changeApiKeyBtn:STRINGS.setApiKeyBtn)+'</button>'+(settings.apiKeyStatus === 'set'?'<button class="btn btn-secondary" id="clear-api-key-btn" type="button">'+STRINGS.clearApiKeyBtn+'</button>':'')+'</div></section>'+
    '<section class="settings-section" data-section="tickets"><h3>'+STRINGS.sectionTickets+'</h3>'+
    '<label class="setting-row" for="set-ticket-limit"><span class="setting-label">'+STRINGS.ticketLimitLabel+'</span><input class="setting-input setting-input-num" id="set-ticket-limit" type="number" min="1" max="500" value="'+esc(settings.ticketListLimit)+'"></label>'+
    '<label class="setting-row" for="set-include-children"><span class="setting-label">'+STRINGS.includeChildProjectsLabel+'</span><input class="setting-check" id="set-include-children" type="checkbox"'+(settings.includeChildProjects?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-status"><span class="setting-label">'+STRINGS.showStatusLabel+'</span><input class="setting-check" id="set-show-status" type="checkbox"'+(settings.showStatus?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-due-date"><span class="setting-label">'+STRINGS.showDueDateLabel+'</span><input class="setting-check" id="set-show-due-date" type="checkbox"'+(settings.showDueDate?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-tracker"><span class="setting-label">'+STRINGS.showTrackerLabel+'</span><input class="setting-check" id="set-show-tracker" type="checkbox"'+(settings.showTracker?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-priority"><span class="setting-label">'+STRINGS.showPriorityLabel+'</span><input class="setting-check" id="set-show-priority" type="checkbox"'+(settings.showPriority?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-assignee"><span class="setting-label">'+STRINGS.showAssigneeLabel+'</span><input class="setting-check" id="set-show-assignee" type="checkbox"'+(settings.showAssignee?' checked':'')+'></label></section>'+
    '<section class="settings-section" data-section="editor"><h3>'+STRINGS.sectionEditor+'</h3>'+
    '<label class="setting-row" for="set-editor-storage"><span class="setting-label">'+STRINGS.editorStorageDirectoryLabel+'</span><input class="setting-input" id="set-editor-storage" type="text" value="'+esc(settings.editorStorageDirectory)+'"></label>'+
    '<label class="setting-row" for="set-editor-subject"><span class="setting-label">'+STRINGS.defaultSubjectLabel+'</span><input class="setting-input" id="set-editor-subject" type="text" data-editor-default="subject" value="'+esc(defaults.subject)+'"></label>'+
    '<label class="setting-row setting-row-stacked" for="set-editor-description"><span class="setting-label">'+STRINGS.defaultDescriptionLabel+'</span><textarea class="setting-input" id="set-editor-description" data-editor-default="description" rows="3">'+esc(defaults.description)+'</textarea></label>'+
    '<label class="setting-row" for="set-editor-tracker"><span class="setting-label">'+STRINGS.defaultTrackerLabel+'</span><input class="setting-input" id="set-editor-tracker" type="text" data-editor-default="tracker" value="'+esc(defaults.tracker)+'"></label>'+
    '<label class="setting-row" for="set-editor-priority"><span class="setting-label">'+STRINGS.defaultPriorityLabel+'</span><input class="setting-input" id="set-editor-priority" type="text" data-editor-default="priority" value="'+esc(defaults.priority)+'"></label>'+
    '<label class="setting-row" for="set-editor-status"><span class="setting-label">'+STRINGS.defaultStatusLabel+'</span><input class="setting-input" id="set-editor-status" type="text" data-editor-default="status" value="'+esc(defaults.status)+'"></label>'+
    '<label class="setting-row" for="set-editor-due-date"><span class="setting-label">'+STRINGS.defaultDueDateLabel+'</span><input class="setting-input" id="set-editor-due-date" type="date" data-editor-default="due_date" value="'+esc(defaults.due_date)+'"></label>'+
    '<button class="btn btn-secondary" id="reset-editor-defaults-btn" type="button">'+STRINGS.resetEditorDefaults+'</button></section>'+
    '<section class="settings-section" data-section="ticket-filter"><h3>'+STRINGS.sectionTicketFilter+'</h3><div id="quick-filter-row"><label class="quick-filter-label" for="assignee-filter-select">'+STRINGS.filterAssigneeLabel+'</label><select id="assignee-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterAssigneeAria)+'"></select><label class="quick-filter-check"><input type="checkbox" id="assignee-unassigned-toggle"> '+STRINGS.filterIncludeUnassignedLabel+'</label><label class="quick-filter-label" for="status-filter-select">'+STRINGS.filterStatusLabel+'</label><select id="status-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterStatusAria)+'"></select></div></section>'+
    '<section class="settings-section" data-section="sort"><h3>'+STRINGS.sectionSort+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.sortFieldLabel+'</span><select class="setting-select" id="set-sort-field">'+selectOptions(sortFields(),settings.sort.field || '')+'</select></label><label class="setting-row"><span class="setting-label">'+STRINGS.sortDirectionLabel+'</span><select class="setting-select" id="set-sort-dir">'+selectOptions([['asc',STRINGS.sortAsc],['desc',STRINGS.sortDesc]],settings.sort.direction)+'</select></label></section>'+
    '<section class="settings-section" data-section="due-date"><h3>'+STRINGS.sectionDueDate+'</h3>'+dueToggles(settings.dueDate)+'</section>'+
    '<section class="settings-section" data-section="sync"><h3>'+STRINGS.sectionSync+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.offlineSyncModeLabel+'</span><select class="setting-select" id="set-sync-mode">'+selectOptions([['auto',STRINGS.offlineSyncAuto],['manual',STRINGS.offlineSyncManual]],settings.offlineSyncMode)+'</select></label></section>';
  element.insertAdjacentHTML('beforeend','<section class="settings-section" data-section="maintenance"><h3>'+esc(STRINGS.sectionMaintenance)+'</h3>'+
    '<h4 class="maintenance-heading">'+esc(STRINGS.dashboardCacheHeading)+'</h4><p class="maintenance-description">'+esc(STRINGS.dashboardCacheDescription)+'</p><button class="btn btn-secondary" id="dashboard-cache-reset-btn" type="button">'+esc(STRINGS.resetDashboardCache)+'</button>'+
    '<h4 class="maintenance-heading">'+esc(STRINGS.dashboardViewStateHeading)+'</h4><p class="maintenance-description">'+esc(STRINGS.dashboardViewStateDescription)+'</p><button class="btn btn-secondary" id="settings-reset-view-btn" type="button">'+esc(STRINGS.resetViewState)+'</button>'+
    '<p class="maintenance-safety-note" role="note">'+esc(STRINGS.maintenanceSafetyNote)+'</p></section>');
  const sections=new Map(Array.from(element.children).map(function(section){ return [section.dataset.section,section]; })); element.replaceChildren();
  [['tickets',STRINGS.sectionTickets,['tickets','ticket-filter','sort','due-date']],['sync',STRINGS.sectionSync,['sync']],['editor',STRINGS.sectionEditor,['editor']],['connection',STRINGS.sectionConnection,['connection']],['maintenance',STRINGS.sectionMaintenance,['maintenance']]].forEach(function(group){
    const category=document.createElement('details'); category.className='settings-category'; category.dataset.category=group[0]; category.id='settings-'+group[0]; category.open=hadCategories ? openCategories.has(group[0]) : group[0] === 'tickets';
    const heading=document.createElement('summary'); heading.id='settings-'+group[0]+'-summary'; heading.textContent=group[1]; category.appendChild(heading);
    group[2].forEach(function(id){ const section=sections.get(id); if(section) category.appendChild(section); }); element.appendChild(category);
  });
  if(focused){ const input=document.getElementById(focused.id); if(input && 'value' in input) input.value=focused.value; }
  const assignees=state.ticketFilterOptions.assignees || []; const statuses=state.ticketFilterOptions.statuses || []; const assigneeSelect=document.getElementById('assignee-filter-select'); const statusSelect=document.getElementById('status-filter-select'); assigneeSelect.innerHTML=assignees.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.assigneeIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); statusSelect.innerHTML=statuses.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.statusIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); assigneeSelect.disabled=!assignees.length; statusSelect.disabled=!statuses.length; document.getElementById('assignee-unassigned-toggle').checked=!!settings.filters.includeUnassigned;
  const updateFilters=function(){ req('settings.update',{patch:{filters:Object.assign({},settings.filters,{assigneeIds:Array.from(assigneeSelect.selectedOptions).map(function(option){ return Number(option.value); }),statusIds:Array.from(statusSelect.selectedOptions).map(function(option){ return Number(option.value); }),includeUnassigned:document.getElementById('assignee-unassigned-toggle').checked})}}); }; assigneeSelect.addEventListener('change',updateFilters); statusSelect.addEventListener('change',updateFilters); document.getElementById('assignee-unassigned-toggle').addEventListener('change',updateFilters);
  document.getElementById('set-sort-field').addEventListener('change',function(){ req('settings.update',{patch:{sort:{field:this.value || undefined,direction:settings.sort.direction}}}); }); document.getElementById('set-sort-dir').addEventListener('change',function(){ req('settings.update',{patch:{sort:{field:settings.sort.field,direction:this.value}}}); });
  [['set-dd-overdue','showOverdue'],['set-dd-1d','showWithin1Day'],['set-dd-3d','showWithin3Days'],['set-dd-7d','showWithin7Days']].forEach(function(item){ document.getElementById(item[0]).addEventListener('change',function(){ const due=Object.assign({},settings.dueDate); due[item[1]]=this.checked; req('settings.update',{patch:{dueDate:due}}); }); });
  document.getElementById('set-base-url').addEventListener('change',function(){ req('settings.updateConnection',{patch:{baseUrl:this.value}}); }); document.getElementById('set-default-project').addEventListener('change',function(){ req('settings.updateConnection',{patch:{defaultProjectId:this.value}}); }); document.getElementById('set-request-timeout').addEventListener('change',function(){ const value=Number(this.value); if(Number.isFinite(value) && value > 0) req('settings.updateConnection',{patch:{requestTimeoutMs:value}}); }); document.getElementById('set-ignore-ssl').addEventListener('change',function(){ req('settings.updateConnection',{patch:{ignoreSSLErrors:this.checked}}); });
  document.getElementById('set-ticket-limit').addEventListener('change',function(){ const value=Number(this.value); if(value >= 1 && value <= 500) req('settings.updateGeneral',{patch:{ticketListLimit:value}}); }); document.getElementById('set-include-children').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{includeChildProjects:this.checked}}); }); document.getElementById('set-show-status').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showStatus:this.checked}}); }); document.getElementById('set-show-due-date').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showDueDate:this.checked}}); }); document.getElementById('set-show-tracker').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showTracker:this.checked}}); }); document.getElementById('set-show-priority').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showPriority:this.checked}}); }); document.getElementById('set-show-assignee').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{showAssignee:this.checked}}); }); document.getElementById('set-sync-mode').addEventListener('change',function(){ req('settings.updateGeneral',{patch:{offlineSyncMode:this.value}}); });
  document.getElementById('set-editor-storage').addEventListener('change',function(){ req('settings.updateEditor',{patch:{editorStorageDirectory:this.value}}); }); document.querySelectorAll('[data-editor-default]').forEach(function(input){ input.addEventListener('change',function(){ req('settings.updateEditorDefault',{field:this.dataset.editorDefault,value:this.value}); }); }); document.getElementById('reset-editor-defaults-btn').addEventListener('click',function(){ req('settings.resetEditorDefaults',{fields:['subject','description','tracker','priority','status','due_date']}); });
  document.getElementById('set-apikey-btn').addEventListener('click',function(){ req('apiKey.set'); }); document.getElementById('clear-api-key-btn')?.addEventListener('click',function(){ req('apiKey.clear'); }); document.getElementById('settings-reset-btn').onclick=function(){ req('settings.reset'); };
  document.getElementById('dashboard-cache-reset-btn').addEventListener('click',function(){ req('dashboard.resetCache'); }); document.getElementById('settings-reset-view-btn').addEventListener('click',resetViewState);
}

function resetViewState(){
  ticketLayoutMode='auto'; detailTab='overview'; quickFilters.clear();
  expandedTicketIds.clear(); collapsedTicketIds.clear(); expandedComments.clear(); ticketDetailExpanded=false; metadataExpanded=false;
  activeTicketActionMenuId=null; activeTicketActionAnchorTop=null; searchQuery='';
  if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; }
  searchInput.value=''; updateSearchClearButton(); filterDialog.classList.add('hidden'); closeLayoutPopover();
  document.querySelectorAll('.settings-category').forEach(function(category){ category.open=category.dataset.category === 'tickets'; });
  vscode.setState(Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode,detailTab:detailTab,quickFilters:[]}));
  if(!state || !state.selectedProject) req('tickets.searchAllProjects',{query:''});
  render(); applyTicketLayoutMode(); showToast('success',STRINGS.viewStateReset);
}

function renderSettings(){
  renderSettingsBase();
}

// ── Render and extension messages ─────────────────────────────────────────
function render(){
  if(!state) return; const focus=captureFocus(document); closeTicketActionMenus(); syncExpandedState(state.tickets);
  const select=document.getElementById('project-select'); while(select.options.length > 1) select.remove(1);
  (state.projects || []).forEach(function(project){ const option=document.createElement('option'); option.value=String(project.id); option.textContent='  '.repeat(project.level || 0)+(project.name || (STRINGS.projectLabel+' #'+project.id)); select.appendChild(option); }); if(state.selectedProject && state.selectedProject.id) select.value=String(state.selectedProject.id); else select.value='';
  select.title=state.selectedProject?.name || STRINGS.selectProjectTitle;
  document.getElementById('include-children').checked=!!state.includeChildProjects; renderTickets(); renderTicketDetail(); renderFilterChips(); renderUnsynced(); renderComments(); renderSettings(); renderSyncTray(); updateSyncButtonStates(); restoreFocus(focus);
}
window.addEventListener('message',function(event){ const message=event.data || {}; if(message.type === 'dashboard.state'){
    const previous=state;
    const projectChanged=previous?.selectedProject?.id !== message.state.selectedProject?.id;
    if(projectChanged){ expandedTicketIds.clear(); collapsedTicketIds.clear(); }
    const connectionChanged=previous?.settings?.baseUrl !== message.state.settings?.baseUrl;
    const ticketChanged=previous?.selectedTicketId !== message.state.selectedTicketId;
    const leavingDetail=message.state.workPanel && message.state.workPanel.mode !== 'detail';
    if(projectChanged || connectionChanged || ticketChanged || leavingDetail || !message.state.selectedTicket) metadataEdit=null;
    const previousComposer=previous?.workPanel;
    state=message.state;
    const panel=state.workPanel;
    const openingComposer=panel && panel.mode !== 'detail' && (!previousComposer || previousComposer.mode !== panel.mode || previousComposer.projectId !== panel.projectId);
    if(openingComposer) activateTab('tickets');
    render();
    if(panel && panel.mode !== 'detail' && !panel.loading && (openingComposer || previousComposer?.loading)) document.getElementById('work-tracker')?.focus();
    if(previousComposer?.mode === 'newTicket' && (!panel || panel.mode === 'detail')) document.getElementById('new-ticket-btn').focus();
  } else if(message.type === 'operation.started'){ startOperation(message.requestId,message.label); } else if(message.type === 'operation.success'){ endOperation(message.requestId); finishMetadataOperation(message.requestId,true); finishOperation('success',message.requestId,message.message); showToast('success',message.message); } else if(message.type === 'operation.error'){ endOperation(message.requestId); finishMetadataOperation(message.requestId,false); finishOperation('error',message.requestId,message.message); showToast('error',message.message); } else if(message.type === 'toast'){ showToast(message.level,message.message); } });
req('dashboard.ready');
`;
