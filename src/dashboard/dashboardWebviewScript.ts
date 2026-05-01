/** Dashboard Webview — ブラウザ側スクリプト (HTML に埋め込む文字列) */
export const dashboardWebviewScript = String.raw`
'use strict';
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let state = null;
let reqCounter = 0;
let activeTicketActionMenuId = null;
let ticketDetailExpanded = false;
const nextReqId = () => 'req-' + (++reqCounter);

// ── Utils ──────────────────────────────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
function send(msg){ vscode.postMessage(msg); }
function req(type, extra){ send({type, requestId:nextReqId(), ...extra}); }
function isTicketActionTarget(target){ return !!target.closest('.ticket-action-btn,.ticket-action-menu,.expand-btn'); }

// ── Toast / operation feedback ─────────────────────────────────────────────
const activeSyncRequests = new Set();

function showToast(level, message){
  const area = document.getElementById('toast-area');
  const el = document.createElement('div');
  el.className = 'toast toast-' + level;
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => { el.classList.add('toast-fade'); }, 3200);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
}

function startOperation(requestId){
  activeSyncRequests.add(requestId);
  updateSyncButtonStates();
}

function endOperation(requestId){
  activeSyncRequests.delete(requestId);
  updateSyncButtonStates();
}

function updateSyncButtonStates(){
  const busy = activeSyncRequests.size > 0;
  document.querySelectorAll('[data-sync-key],[data-discard-key]').forEach(btn => { btn.disabled = busy; });
  const syncAll = document.getElementById('sync-all-btn');
  if (syncAll) syncAll.disabled = busy;
}

// ── Tabs ───────────────────────────────────────────────────────────────────
const tabs = document.querySelectorAll('[role="tab"]');
const panels = document.querySelectorAll('[role="tabpanel"]');
function activateTab(name){
  tabs.forEach(t=>{
    const active = t.dataset.tab===name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  panels.forEach(p=>{ p.classList.toggle('active', p.id==='panel-'+name); });
}
tabs.forEach(t=>{ t.addEventListener('click',()=>activateTab(t.dataset.tab)); });
document.getElementById('tabs').addEventListener('keydown',function(e){
  const tabEls = Array.from(this.querySelectorAll('[role="tab"]'));
  const activeIdx = tabEls.findIndex(t=>t.getAttribute('aria-selected')==='true');
  if(e.key==='ArrowRight'){
    const next = tabEls[(activeIdx+1)%tabEls.length];
    activateTab(next.dataset.tab); next.focus();
    e.preventDefault();
  } else if(e.key==='ArrowLeft'){
    const prev = tabEls[(activeIdx-1+tabEls.length)%tabEls.length];
    activateTab(prev.dataset.tab); prev.focus();
    e.preventDefault();
  }
});

// ── Header ─────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click',()=>req('dashboard.refresh'));
document.getElementById('new-ticket-btn').addEventListener('click',()=>req('ticket.create'));
document.getElementById('include-children').addEventListener('change',function(){
  req('project.toggleChildren',{includeChildProjects:this.checked});
});
document.getElementById('project-select').addEventListener('change',function(){
  if(this.value) req('project.select',{projectId:Number(this.value)});
});

// ── Search ─────────────────────────────────────────────────────────────────
let searchQuery = '';
document.getElementById('search-input').addEventListener('input',function(){
  searchQuery = this.value.toLowerCase();
  renderTickets();
});

// ── Sync state label map ───────────────────────────────────────────────────
const SYNC_LABEL = {
  Dirty: '未同期',
  Queued: 'キュー済み',
  Conflict: '競合',
  Failed: '失敗',
  Syncing: '同期中',
};

// ── Ticket expand/collapse state ───────────────────────────────────────────
const expandedIds = new Set();
function syncExpandState(nodes){
  for(const n of nodes){
    if(n.children?.length && !expandedIds.has(n.id)) expandedIds.add(n.id);
    if(n.children?.length) syncExpandState(n.children);
  }
}
function toggleExpand(ticketId){
  if(expandedIds.has(ticketId)) expandedIds.delete(ticketId); else expandedIds.add(ticketId);
  renderTickets();
}
function flattenVisible(nodes, result=[]){
  for(const n of nodes){
    result.push(n);
    if(n.children?.length && expandedIds.has(n.id)) flattenVisible(n.children, result);
  }
  return result;
}

// ── Ticket row actions ──────────────────────────────────────────────────────
function closeTicketActionMenus(){
  document.querySelectorAll('.ticket-action-menu').forEach(menu=>menu.classList.add('hidden'));
  document.querySelectorAll('.ticket-action-btn[aria-expanded="true"]').forEach(btn=>btn.setAttribute('aria-expanded','false'));
  activeTicketActionMenuId = null;
}
function toggleTicketActionMenu(ticketId){
  const menuId = 'ticket-action-menu-' + ticketId;
  const shouldOpen = activeTicketActionMenuId !== menuId;
  closeTicketActionMenus();
  if(!shouldOpen) return;
  const menu = document.getElementById(menuId);
  const btn = document.querySelector('[data-ticket-action-menu="'+ticketId+'"]');
  if(menu){ menu.classList.remove('hidden'); }
  if(btn){ btn.setAttribute('aria-expanded','true'); }
  activeTicketActionMenuId = menuId;
}
function runTicketAction(action, ticketId){
  closeTicketActionMenus();
  if(action === 'open') req('ticket.openEditor',{ticketId});
  else if(action === 'comment') req('comment.add',{ticketId});
  else if(action === 'browser') req('ticket.openBrowser',{ticketId});
  else if(action === 'child') req('ticket.createChild',{parentTicketId:ticketId});
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.ticket-action-menu,.ticket-action-btn')) closeTicketActionMenus();
});
document.addEventListener('keydown',e=>{
  if(e.key === 'Escape') closeTicketActionMenus();
});

// ── Ticket rendering ────────────────────────────────────────────────────────
function matchesSearch(t){
  if(!searchQuery) return true;
  return t.subject.toLowerCase().includes(searchQuery) || String(t.id).includes(searchQuery);
}
function syncBadgeClass(s){
  const m={Dirty:'sync-dirty',Queued:'sync-queued',Conflict:'sync-conflict',Failed:'sync-failed',Syncing:'sync-syncing'};
  return m[s]||'';
}
function findTicketNode(nodes, ticketId){
  for(const node of nodes || []){
    if(node.id === ticketId) return node;
    const child = findTicketNode(node.children, ticketId);
    if(child) return child;
  }
  return null;
}
function flattenAll(nodes, result=[]){
  for(const n of nodes || []){
    result.push(n);
    if(n.children?.length) flattenAll(n.children, result);
  }
  return result;
}
function uniqueSortedOptions(items){
  const map = new Map();
  for(const item of items){
    if(!item || item.id===undefined || !item.label) continue;
    if(!map.has(item.id)) map.set(item.id, item.label);
  }
  return Array.from(map.entries())
    .map(([id,label])=>({id,label}))
    .sort((a,b)=>a.label.localeCompare(b.label, 'ja'));
}
function selectedNumericValues(selectEl){
  return Array.from(selectEl?.selectedOptions || [])
    .map(option=>Number(option.value))
    .filter(v=>Number.isInteger(v) && v > 0);
}
function applyDashboardFilters(){
  const assigneeSelect = document.getElementById('assignee-filter-select');
  const statusSelect = document.getElementById('status-filter-select');
  const includeUnassigned = document.getElementById('assignee-unassigned-toggle');
  const patch = {
    filters: {
      ...state.settings.filters,
      assigneeIds: selectedNumericValues(assigneeSelect),
      statusIds: selectedNumericValues(statusSelect),
      includeUnassigned: !!includeUnassigned?.checked,
    },
  };
  req('settings.update', { patch });
}
function bindDashboardFilterHandlers(){
  const assigneeSelect = document.getElementById('assignee-filter-select');
  const statusSelect = document.getElementById('status-filter-select');
  const includeUnassigned = document.getElementById('assignee-unassigned-toggle');
  assigneeSelect?.addEventListener('change', applyDashboardFilters);
  statusSelect?.addEventListener('change', applyDashboardFilters);
  includeUnassigned?.addEventListener('change', applyDashboardFilters);
}
function renderQuickFilters(){
  if(!state) return;
  const assigneeSelect = document.getElementById('assignee-filter-select');
  const statusSelect = document.getElementById('status-filter-select');
  const includeUnassigned = document.getElementById('assignee-unassigned-toggle');
  if(!assigneeSelect || !statusSelect || !includeUnassigned) return;
  const assigneeOptions = (state.ticketFilterOptions?.assignees || []).map(option => ({
    id: option.id,
    label: option.name,
  }));
  const statusOptions = (state.ticketFilterOptions?.statuses || []).map(option => ({
    id: option.id,
    label: option.name,
  }));
  const selectedAssignees = new Set(state.settings.filters.assigneeIds || []);
  const selectedStatuses = new Set(state.settings.filters.statusIds || []);
  assigneeSelect.disabled = assigneeOptions.length === 0;
  statusSelect.disabled = statusOptions.length === 0;
  assigneeSelect.innerHTML = assigneeOptions.map(option =>
    '<option value="'+option.id+'"'+(selectedAssignees.has(option.id)?' selected':'')+'>'+esc(option.label)+'</option>'
  ).join('');
  statusSelect.innerHTML = statusOptions.map(option =>
    '<option value="'+option.id+'"'+(selectedStatuses.has(option.id)?' selected':'')+'>'+esc(option.label)+'</option>'
  ).join('');
  includeUnassigned.checked = !!state.settings.filters.includeUnassigned;
}
function renderTickets(){
  if(!state) return;
  const list = document.getElementById('ticket-list');
  if(!state.selectedProject && !state.tickets.length && !state.loading.tickets){
    list.innerHTML='<div class="state-msg"><strong>プロジェクト未選択</strong>上でプロジェクトを選択してチケットを表示します。</div>';
    updateSyncButtonStates();
    return;
  }
  if(state.loading.tickets){
    list.innerHTML='<div class="state-msg">チケットを読み込み中…</div>';
    updateSyncButtonStates();
    return;
  }
  if(state.errors.tickets){
    list.innerHTML='<div class="state-msg error-msg"><strong>エラー</strong>'+esc(state.errors.tickets)+'</div>';
    updateSyncButtonStates();
    return;
  }
  const flat = flattenVisible(state.tickets).filter(matchesSearch);
  if(!flat.length){
    list.innerHTML='<div class="state-msg">フィルター条件に一致するチケットがありません。</div>';
  } else {
    list.innerHTML = flat.map(t=>{
      const indent = t.level*14;
      const sel = t.id===state.selectedTicketId?' selected':'';
      const syncCls = syncBadgeClass(t.syncState);
      const syncLabel = SYNC_LABEL[t.syncState] || t.syncState;
      const syncBadge = (t.syncState&&t.syncState!=='Synced')
        ?'<span class="badge '+syncCls+'">'+esc(syncLabel)+'</span>':'';
      const statusBadge = t.statusName
        ?'<span class="badge ticket-status">'+esc(t.statusName)+'</span>'
        :'';
      const hasChildren = t.children?.length > 0;
      const isExpanded = expandedIds.has(t.id);
      const expandBtn = hasChildren
        ?'<button class="expand-btn" type="button" data-expand="'+t.id+'" aria-expanded="'+isExpanded+'" title="'+(isExpanded?'折りたたむ':'展開する')+'"><span class="expand-icon '+(isExpanded?'expanded':'collapsed')+'"></span></button>'
        :'<span class="expand-placeholder"></span>';
      const childConnector = t.level>0?'<span class="child-connector" aria-hidden="true">↳</span>':'';
      const actionMenu = '<span class="ticket-actions">'
        +'<button class="ticket-action-btn" type="button" data-ticket-action-menu="'+t.id+'" aria-haspopup="menu" aria-expanded="false" aria-controls="ticket-action-menu-'+t.id+'" aria-label="チケット操作" title="チケット操作"><span class="icon-more" aria-hidden="true"></span></button>'
        +'<span class="ticket-action-menu hidden" id="ticket-action-menu-'+t.id+'" role="menu">'
        +'<button type="button" role="menuitem" data-ticket-action="open" data-ticket="'+t.id+'">エディタで開く</button>'
        +'<button type="button" role="menuitem" data-ticket-action="comment" data-ticket="'+t.id+'">コメント追加</button>'
        +'<button type="button" role="menuitem" data-ticket-action="browser" data-ticket="'+t.id+'">ブラウザで開く</button>'
        +'<button type="button" role="menuitem" data-ticket-action="child" data-ticket="'+t.id+'">子チケット作成</button>'
        +'</span></span>';
      return '<div class="ticket-row'+(t.level>0?' child-row':'')+sel+'" data-id="'+t.id+'" style="padding-left:'+(12+indent)+'px" tabindex="0">'
        +expandBtn
        +childConnector
        +'<span class="ticket-id">#'+t.id+'</span>'
        +'<span class="ticket-subject" title="'+esc(t.subject)+'">'+esc(t.subject)+'</span>'
        +'<span class="badges">'+statusBadge+syncBadge+'</span>'
        +actionMenu
        +'</div>';
    }).join('');
    list.querySelectorAll('.ticket-row').forEach(row=>{
      row.addEventListener('click',e=>{
        if(isTicketActionTarget(e.target)) return;
        const id=Number(row.dataset.id);
        if(state.selectedTicketId === id) {
          ticketDetailExpanded = true;
          renderTicketDetail();
        }
        req('ticket.select',{ticketId:id});
      });
      row.addEventListener('dblclick',e=>{
        if(isTicketActionTarget(e.target)) return;
        const id=Number(row.dataset.id);
        req('ticket.openEditor',{ticketId:id});
      });
      row.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key===' '){
          const expandBtn=row.querySelector('.expand-btn');
          if(e.target===expandBtn){ toggleExpand(Number(expandBtn.dataset.expand)); e.preventDefault(); return; }
          if(e.key==='Enter') row.click();
        }
      });
    });
    list.querySelectorAll('.expand-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        toggleExpand(Number(btn.dataset.expand));
      });
    });
    list.querySelectorAll('[data-ticket-action-menu]').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        toggleTicketActionMenu(Number(btn.dataset.ticketActionMenu));
      });
    });
    list.querySelectorAll('[data-ticket-action]').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        runTicketAction(btn.dataset.ticketAction, Number(btn.dataset.ticket));
      });
    });
  }
  const lm = document.getElementById('load-more-row');
  if(state.loadedTicketCount < state.totalTicketCount){
    lm.style.display='block';
    lm.textContent='さらに読み込む… ('+state.loadedTicketCount+' / '+state.totalTicketCount+')';
    lm.onclick=()=>req('tickets.loadMore');
  } else { lm.style.display='none'; }
  updateSyncButtonStates();
}

// ── Selected ticket detail ─────────────────────────────────────────────────
function metadataOptionsReady(){
  return !!(state?.metadataOptions?.trackers?.length && state.metadataOptions?.priorities?.length && state.metadataOptions?.statuses?.length);
}
function renderSelect(name, value, options, label){
  const disabled = metadataOptionsReady() ? '' : ' disabled';
  const optionList = options || [];
  const currentOption = value && !optionList.some(option => option.name === value)
    ? '<option value="'+esc(value)+'" selected>'+esc(value)+'</option>'
    : '';
  const opts = currentOption + optionList.map(option =>
    '<option value="'+esc(option.name)+'"'+(option.name===value?' selected':'')+'>'+esc(option.name)+'</option>'
  ).join('');
  return '<label class="detail-field"><span>'+label+'</span><select class="detail-select" data-metadata-field="'+name+'"'+disabled+'>'+opts+'</select></label>';
}
function renderTicketDetailPanel(ticket){
  const card = document.getElementById('ticket-detail-card');
  const node = findTicketNode(state.tickets, ticket.id) || {};
  const projectLabel = ticket.projectName
    ? esc(ticket.projectName)+' / ID: '+esc(ticket.projectId ?? '')
    : 'Project ID: '+esc(ticket.projectId ?? '未設定');
  const parentLabel = ticket.parentId
    ? '<div class="detail-parent">Parent: #'+ticket.parentId+(ticket.parentSubject ? ' '+esc(ticket.parentSubject) : '')+'</div>'
    : '';
  const options = state.metadataOptions || {trackers:[],priorities:[],statuses:[]};
  const readonlyHint = metadataOptionsReady() ? '' : '<div class="detail-readonly">選択肢を取得できないため編集できません。</div>';
  const expanded = ticketDetailExpanded
    ? '<div class="detail-expanded">'
      + renderSelect('tracker', ticket.trackerName || node.trackerName || '', options.trackers, 'Tracker')
      + renderSelect('priority', ticket.priorityName || node.priorityName || '', options.priorities, 'Priority')
      + renderSelect('status', ticket.statusName || node.statusName || '', options.statuses, 'Status')
      + '<label class="detail-field"><span>Start date</span><input class="detail-input" data-metadata-field="start_date" type="date" value="'+esc(ticket.startDate || node.startDate || '')+'"'+(metadataOptionsReady()?'':' disabled')+'></label>'
      + '<label class="detail-field"><span>Due date</span><input class="detail-input" data-metadata-field="due_date" type="date" value="'+esc(ticket.dueDate || node.dueDate || '')+'"'+(metadataOptionsReady()?'':' disabled')+'></label>'
      + '<div class="detail-meta"><span>Sync</span><strong>'+esc(ticket.syncState)+'</strong></div>'
      + (ticket.lastSyncedAt ? '<div class="detail-meta"><span>Last synced</span><strong>'+esc(ticket.lastSyncedAt.substring(0,19).replace('T',' '))+'</strong></div>' : '')
      + readonlyHint
      + '</div>'
    : '';
  card.classList.remove('hidden');
  card.innerHTML =
    '<div class="detail-head">'
    + '<div class="detail-title"><span class="ticket-id">#'+ticket.id+'</span><span>'+esc(ticket.subject)+'</span></div>'
    + '<button class="btn-icon detail-toggle" id="ticket-detail-toggle" title="'+(ticketDetailExpanded?'詳細を閉じる':'詳細を開く')+'" aria-expanded="'+ticketDetailExpanded+'">'+(ticketDetailExpanded?'⌃':'⌄')+'</button>'
    + '</div>'
    + '<div class="detail-project">'+projectLabel+'</div>'
    + parentLabel
    + '<div class="detail-actions">'
    + '<button class="btn btn-secondary" id="detail-open-btn">開く</button>'
    + '<button class="btn btn-secondary" id="detail-comment-btn">コメント</button>'
    + '<button class="btn btn-primary" id="detail-sync-btn">同期</button>'
    + '</div>'
    + expanded;
  card.querySelector('#ticket-detail-toggle')?.addEventListener('click',()=>{
    ticketDetailExpanded = !ticketDetailExpanded;
    renderTicketDetail();
  });
  card.querySelector('#detail-open-btn')?.addEventListener('click',()=>req('ticket.openEditor',{ticketId:ticket.id}));
  card.querySelector('#detail-comment-btn')?.addEventListener('click',()=>req('comment.add',{ticketId:ticket.id}));
  card.querySelector('#detail-sync-btn')?.addEventListener('click',()=>req('ticket.syncSelected',{ticketId:ticket.id}));
  card.querySelectorAll('[data-metadata-field]').forEach(input=>{
    input.addEventListener('change',()=>{
      const field = input.dataset.metadataField;
      req('ticket.metadata.update',{ticketId:ticket.id,patch:{[field]:input.value}});
    });
  });
}

function renderComposerPanel(panel){
  const card = document.getElementById('ticket-detail-card');
  card.classList.remove('hidden');
  const title = panel.mode === 'childTicket' ? '子チケット作成' : '新規チケット作成';
  const parentLabel = panel.mode === 'childTicket'
    ? '<div class="work-panel-subtitle">Parent: #'+panel.parentTicketId+' '+esc(panel.parentSubject || '')+'</div>'
    : '';
  const errorHtml = panel.error ? '<div class="composer-error">'+esc(panel.error)+'</div>' : '';
  if(panel.loading){
    card.innerHTML =
      '<div class="work-panel-head"><div class="work-panel-title">'+title+'</div></div>'
      +'<div class="composer-loading">トラッカーを読み込み中…</div>';
    return;
  }
  const values = panel.values || {};
  const trackerOptions = (panel.trackers || []).map(item => '<option value="'+esc(item.name)+'"'+(item.name===values.tracker?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const priorityOptions = (panel.priorities || []).map(item => '<option value="'+esc(item.name)+'"'+(item.name===values.priority?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const statusOptions = (panel.statuses || []).map(item => '<option value="'+esc(item.name)+'"'+(item.name===values.status?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const canCreate = values.tracker && values.priority && values.status;
  card.innerHTML =
    '<div class="work-panel-head"><div class="work-panel-title">'+title+'</div><div class="work-panel-subtitle">'+esc(panel.projectName || ('Project #'+panel.projectId))+'</div>'+parentLabel+'</div>'
    +errorHtml
    +'<div class="composer-actions composer-actions-top"><button class="btn btn-secondary" id="work-cancel">キャンセル</button><button class="btn btn-primary" id="work-create"'+(canCreate?'':' disabled')+'>Markdownドラフト作成</button><button class="btn btn-secondary" id="work-sync-new-ticket">同期</button></div>'
    +'<div class="composer-grid composer-grid-detail">'
    +'<label class="detail-field composer-detail-field"><span>Tracker <span class="composer-required">*</span></span><select class="detail-select composer-select" id="work-tracker"><option value="">Select...</option>'+trackerOptions+'</select></label>'
    +'<label class="detail-field composer-detail-field"><span>Priority <span class="composer-required">*</span></span><select class="detail-select composer-select" id="work-priority"><option value="">Select...</option>'+priorityOptions+'</select></label>'
    +'<label class="detail-field composer-detail-field"><span>Status <span class="composer-required">*</span></span><select class="detail-select composer-select" id="work-status"><option value="">Select...</option>'+statusOptions+'</select></label>'
    +'<label class="detail-field composer-detail-field"><span>Start date</span><input class="detail-input composer-input" id="work-start-date" type="date" value="'+esc(values.start_date || '')+'"></label>'
    +'<label class="detail-field composer-detail-field"><span>Due date</span><input class="detail-input composer-input" id="work-due-date" type="date" value="'+esc(values.due_date || '')+'"></label>'
    +'</div>';

  const trackerEl = card.querySelector('#work-tracker');
  const priorityEl = card.querySelector('#work-priority');
  const statusEl = card.querySelector('#work-status');
  const startDateEl = card.querySelector('#work-start-date');
  const dueDateEl = card.querySelector('#work-due-date');
  const readValues = () => ({
    tracker: trackerEl?.value || '',
    priority: priorityEl?.value || '',
    status: statusEl?.value || '',
    start_date: startDateEl?.value || undefined,
    due_date: dueDateEl?.value || undefined,
  });

  card.querySelector('#work-cancel')?.addEventListener('click',()=>req('ticket.cancelComposer'));
  card.querySelector('#work-create')?.addEventListener('click',()=>req('ticket.createDraftFromComposer',{values:readValues()}));
  card.querySelector('#work-sync-new-ticket')?.addEventListener('click',()=>req('ticket.syncNewTicketDraftFromComposer'));
}

function renderTicketDetail(){
  if(!state) return;
  const card = document.getElementById('ticket-detail-card');
  const panel = state.workPanel;
  if(!panel){
    const ticket = state.selectedTicket;
    if(!ticket){
      card.classList.add('hidden');
      card.innerHTML='';
      return;
    }
    renderTicketDetailPanel(ticket);
    return;
  }
  if(panel.mode === 'detail'){
    const ticket = state.selectedTicket && state.selectedTicket.id===panel.ticketId
      ? state.selectedTicket
      : null;
    if(ticket){
      renderTicketDetailPanel(ticket);
    }else{
      card.classList.add('hidden');
      card.innerHTML='';
    }
    return;
  }
  renderComposerPanel(panel);
}

// ── Filter chips ────────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const f = state.settings.filters;
  const chips=[];
  if(f.subjectQuery) chips.push('件名: '+f.subjectQuery);
  if((f.assigneeIds||[]).length) chips.push('担当者: '+f.assigneeIds.length+'件');
  if(f.includeUnassigned) chips.push('未担当を含む');
  if((f.statusIds||[]).length) chips.push('ステータス: '+f.statusIds.length+'件');
  const el=document.getElementById('filter-chips');
  el.innerHTML=chips.map(label=>'<span class="filter-chip">'+esc(label)+'<span class="filter-chip-x" aria-hidden="true"></span></span>').join('');
}

// ── Unsynced ────────────────────────────────────────────────────────────────
function renderUnsynced(){
  if(!state) return;
  const badge=document.getElementById('unsynced-badge');
  const n=state.unsynced.totalCount;
  badge.textContent=String(n);
  if(n>0){ badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }

  const syncAllBtn=document.getElementById('sync-all-btn');
  if(n>0){ syncAllBtn.classList.remove('hidden'); } else { syncAllBtn.classList.add('hidden'); }
  syncAllBtn.onclick=()=>req('unsynced.syncAll');

  const list=document.getElementById('unsynced-list');
  if(!n){ list.innerHTML='<div class="state-msg">未同期の変更はありません。</div>'; updateSyncButtonStates(); return; }
  const kindLabelMap={ticket:'チケット',newTicket:'新規チケット',comment:'コメント'};
  list.innerHTML=state.unsynced.items.map(item=>{
    const kindLabel=kindLabelMap[item.key.kind]||'ファイル';
    const openBtn=item.documentUri?'<button class="btn btn-secondary" data-uri="'+esc(item.documentUri)+'">開く</button>':'';
    return '<div class="unsynced-card">'
      +'<span class="unsynced-kind-label">'+esc(kindLabel)+'</span>'
      +'<div class="unsynced-body">'
      +'<div class="unsynced-label">'+esc(item.label)+'</div>'
      +(item.detail?'<div class="unsynced-detail">'+esc(item.detail)+'</div>':'')
      +'</div>'
      +'<div class="unsynced-actions">'
      +openBtn
      +'<button class="btn btn-secondary" data-discard-key="'+esc(JSON.stringify(item.key))+'" title="未同期のローカル変更を破棄">破棄</button>'
      +'<button class="btn btn-primary" data-sync-key="'+esc(JSON.stringify(item.key))+'">同期</button>'
      +'</div>'
      +'</div>';
  }).join('');
  list.querySelectorAll('[data-uri]').forEach(btn=>{
    btn.addEventListener('click',()=>req('unsynced.openLocalFile',{documentUri:btn.dataset.uri}));
  });
  list.querySelectorAll('[data-discard-key]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      try{ req('unsynced.discardOne',{key:JSON.parse(btn.dataset.discardKey)}); }catch{}
    });
  });
  list.querySelectorAll('[data-sync-key]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      try{ req('unsynced.syncOne',{key:JSON.parse(btn.dataset.syncKey)}); }catch{}
    });
  });
  updateSyncButtonStates();
}

// ── Comments ────────────────────────────────────────────────────────────────
function renderComments(){
  if(!state) return;
  const c=state.comments;
  const list=document.getElementById('comments-list');
  const ticketId=state.selectedTicketId;
  const header=ticketId
    ?'<div class="comments-header">'
      +'<span class="comments-header-label">チケット #'+ticketId+' のコメント</span>'
      +'<div class="comments-header-actions">'
      +'<button class="btn btn-primary" id="add-comment-btn">追加</button>'
      +'<button class="btn btn-secondary" id="reload-comments-btn">更新</button>'
      +'</div></div>'
    :'';
  if(!ticketId){ list.innerHTML='<div class="state-msg">チケットを選択するとコメントを表示します。</div>'; return; }
  if(c.loading){ list.innerHTML=header+'<div class="state-msg">コメントを読み込み中…</div>'; }
  else if(c.error){ list.innerHTML=header+'<div class="state-msg error-msg">'+esc(c.error)+'</div>'; }
  else if(!c.items.length){ list.innerHTML=header+'<div class="state-msg">コメントはありません。</div>'; }
  else{
    list.innerHTML=header+c.items.map(cm=>{
      const unsyncedBadge=cm.hasUnsyncedEdit
        ?'<span class="badge sync-dirty" aria-label="未同期の修正があります">未同期の修正あり</span>':'' ;
      const editBtn='<button class="btn btn-secondary" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="コメントを編集">編集</button>';
      const browserBtn='<button class="btn btn-secondary" data-open-comment="'+cm.id+'" data-ticket="'+ticketId+'" aria-label="Redmineで開く">Redmineで開く</button>';
      return '<div class="comment-card">'
        +'<div class="comment-header"><span class="comment-author">'+esc(cm.authorName)+'</span>'
        +(cm.updatedAt?'<span class="comment-date">'+esc(cm.updatedAt.substring(0,10))+'</span>':'')
        +'<span class="comment-id">journal #'+cm.id+'</span>'
        +unsyncedBadge
        +'</div>'
        +'<div class="comment-body">'+esc(cm.body)+'</div>'
        +'<div class="comment-actions">'+browserBtn+(editBtn||'')+'</div>'
        +'</div>';
    }).join('');
  }
  list.querySelector('#add-comment-btn')?.addEventListener('click',()=>req('comment.add',{ticketId}));
  list.querySelector('#reload-comments-btn')?.addEventListener('click',()=>req('comment.reload',{ticketId}));
  list.querySelectorAll('[data-edit-comment]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      req('comment.edit',{ticketId:Number(btn.dataset.ticket),commentId:Number(btn.dataset.editComment)});
    });
  });
  list.querySelectorAll('[data-open-comment]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      req('comment.openBrowser',{ticketId:Number(btn.dataset.ticket),commentId:Number(btn.dataset.openComment)});
    });
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
function renderSettings(){
  if(!state) return;
  const s=state.settings;
  const el=document.getElementById('settings-content');
  el.innerHTML=
    '<div class="settings-section"><h3>チケットフィルタ</h3>'
    +'<div id="quick-filter-row">'
    +'<label class="quick-filter-label" for="assignee-filter-select">担当者</label>'
    +'<select id="assignee-filter-select" class="quick-filter-select" multiple size="4" aria-label="担当者フィルター"></select>'
    +'<label class="quick-filter-check"><input type="checkbox" id="assignee-unassigned-toggle"> 未担当を含む</label>'
    +'<label class="quick-filter-label" for="status-filter-select">ステータス</label>'
    +'<select id="status-filter-select" class="quick-filter-select" multiple size="4" aria-label="ステータスフィルター"></select>'
    +'</div>'
    +'</div>'
    +'<div class="settings-section"><h3>並び替え</h3>'
    +'<div class="setting-row"><span class="setting-label">並び替えフィールド</span>'
    +'<select class="setting-select" id="set-sort-field">'
    +'<option value=""'+(s.sort.field?'':' selected')+'>デフォルト</option>'
    +'<option value="priority"'+(s.sort.field==="priority"?' selected':'')+'>優先度</option>'
    +'<option value="status"'+(s.sort.field==="status"?' selected':'')+'>ステータス</option>'
    +'<option value="tracker"'+(s.sort.field==="tracker"?' selected':'')+'>トラッカー</option>'
    +'<option value="assignee"'+(s.sort.field==="assignee"?' selected':'')+'>担当者</option>'
    +'</select></div>'
    +'<div class="setting-row"><span class="setting-label">並び順</span>'
    +'<select class="setting-select" id="set-sort-dir">'
    +'<option value="asc"'+(s.sort.direction==="asc"?' selected':'')+'>昇順</option>'
    +'<option value="desc"'+(s.sort.direction==="desc"?' selected':'')+'>降順</option>'
    +'</select></div>'
    +'</div>'
    +'<div class="settings-section"><h3>期日インジケーター</h3>'
    +'<div class="setting-row"><span class="setting-label">期限超過</span><input type="checkbox" id="set-dd-overdue"'+(s.dueDate.showOverdue?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">1日以内</span><input type="checkbox" id="set-dd-1d"'+(s.dueDate.showWithin1Day?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">3日以内</span><input type="checkbox" id="set-dd-3d"'+(s.dueDate.showWithin3Days?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">7日以内</span><input type="checkbox" id="set-dd-7d"'+(s.dueDate.showWithin7Days?' checked':'')+' class="setting-check"></div>'
    +'</div>'
    +'<div class="settings-section"><h3>同期</h3>'
    +'<div class="setting-row"><span class="setting-label">オフライン同期モード</span>'
    +'<select class="setting-select" id="set-sync-mode">'
    +'<option value="auto"'+(s.offlineSyncMode==="auto"?' selected':'')+'>自動</option>'
    +'<option value="manual"'+(s.offlineSyncMode==="manual"?' selected':'')+'>手動</option>'
    +'</select></div>'
    +'</div>'
    +'<div class="settings-section"><h3>一般</h3>'
    +'<div class="setting-row"><span class="setting-label">チケット取得件数</span>'
    +'<input class="setting-input setting-input-num" id="set-ticket-limit" type="number" min="1" max="500" value="'+s.ticketListLimit+'"></div>'
    +'</div>';

  const applyTicketListPatch=(patch)=>req('settings.update',{patch});
  renderQuickFilters();
  bindDashboardFilterHandlers();

  const sortFieldEl=document.getElementById('set-sort-field');
  sortFieldEl.addEventListener('change',()=>applyTicketListPatch({sort:{field:sortFieldEl.value||undefined,direction:s.sort.direction}}));

  const sortDirEl=document.getElementById('set-sort-dir');
  sortDirEl.addEventListener('change',()=>applyTicketListPatch({sort:{field:s.sort.field,direction:sortDirEl.value}}));

  const ddOverdue=document.getElementById('set-dd-overdue');
  ddOverdue.addEventListener('change',()=>applyTicketListPatch({dueDate:{...s.dueDate,showOverdue:ddOverdue.checked}}));
  const dd1d=document.getElementById('set-dd-1d');
  dd1d.addEventListener('change',()=>applyTicketListPatch({dueDate:{...s.dueDate,showWithin1Day:dd1d.checked}}));
  const dd3d=document.getElementById('set-dd-3d');
  dd3d.addEventListener('change',()=>applyTicketListPatch({dueDate:{...s.dueDate,showWithin3Days:dd3d.checked}}));
  const dd7d=document.getElementById('set-dd-7d');
  dd7d.addEventListener('change',()=>applyTicketListPatch({dueDate:{...s.dueDate,showWithin7Days:dd7d.checked}}));

  const syncModeEl=document.getElementById('set-sync-mode');
  syncModeEl.addEventListener('change',()=>req('settings.updateGeneral',{patch:{offlineSyncMode:syncModeEl.value}}));

  const ticketLimitEl=document.getElementById('set-ticket-limit');
  ticketLimitEl.addEventListener('change',()=>{
    const v=Number(ticketLimitEl.value);
    if(v>=1&&v<=500) req('settings.updateGeneral',{patch:{ticketListLimit:v}});
  });

  document.getElementById('settings-reset-btn').onclick=()=>req('settings.reset');
}

// ── Full render ──────────────────────────────────────────────────────────────
function render(){
  if(!state) return;
  closeTicketActionMenus();
  if(state.tickets) syncExpandState(state.tickets);
  const sel=document.getElementById('project-select');
  const currentVal=sel.value;
  while(sel.options.length>1) sel.remove(1);
  if(state.projects && state.projects.length>0){
    for(const p of state.projects){
      const opt=document.createElement('option');
      opt.value=String(p.id);
      const indent='  '.repeat(p.level);
      opt.textContent=indent+(p.name||'Project #'+p.id);
      sel.appendChild(opt);
    }
  } else if(state.selectedProject?.id){
    const opt=document.createElement('option');
    opt.value=String(state.selectedProject.id);
    opt.textContent=(state.selectedProject.name||'Project #'+state.selectedProject.id);
    sel.appendChild(opt);
  }
  if(state.selectedProject?.id){
    sel.value=String(state.selectedProject.id);
  } else {
    sel.value=currentVal;
  }
  document.getElementById('include-children').checked=state.includeChildProjects;
  renderTickets();
  renderTicketDetail();
  renderFilterChips();
  renderUnsynced();
  renderComments();
  renderSettings();
  updateSyncButtonStates();
}

// ── Messages from extension ──────────────────────────────────────────────────
window.addEventListener('message',event=>{
  const msg=event.data;
  switch(msg.type){
    case 'dashboard.state':
      state=msg.state;
      render();
      break;
    case 'operation.started':
      startOperation(msg.requestId);
      break;
    case 'operation.success':
      endOperation(msg.requestId);
      showToast('success', msg.message);
      break;
    case 'operation.error':
      endOperation(msg.requestId);
      showToast('error', msg.message);
      break;
    case 'toast':
      showToast(msg.level, msg.message);
      break;
  }
});

// ── Ready ────────────────────────────────────────────────────────────────────
req('dashboard.ready');
`;
