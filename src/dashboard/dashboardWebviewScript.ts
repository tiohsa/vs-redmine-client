/** Dashboard Webview — ブラウザ側スクリプト (HTML に埋め込む文字列) */
export const dashboardWebviewScript = String.raw`
'use strict';
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let state = null;
let reqCounter = 0;
let activeTicketActionMenuId = null;
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
      const hasChildren = t.children?.length > 0;
      const isExpanded = expandedIds.has(t.id);
      const expandBtn = hasChildren
        ?'<button class="expand-btn" type="button" data-expand="'+t.id+'" aria-expanded="'+isExpanded+'" title="'+(isExpanded?'折りたたむ':'展開する')+'"><span class="expand-icon '+(isExpanded?'expanded':'collapsed')+'"></span></button>'
        :'<span class="expand-placeholder"></span>';
      const actionMenu = '<span class="ticket-actions">'
        +'<button class="ticket-action-btn" type="button" data-ticket-action-menu="'+t.id+'" aria-haspopup="menu" aria-expanded="false" aria-controls="ticket-action-menu-'+t.id+'" aria-label="チケット操作" title="チケット操作"><span class="icon-more" aria-hidden="true"></span></button>'
        +'<span class="ticket-action-menu hidden" id="ticket-action-menu-'+t.id+'" role="menu">'
        +'<button type="button" role="menuitem" data-ticket-action="open" data-ticket="'+t.id+'">エディタで開く</button>'
        +'<button type="button" role="menuitem" data-ticket-action="comment" data-ticket="'+t.id+'">コメント追加</button>'
        +'<button type="button" role="menuitem" data-ticket-action="browser" data-ticket="'+t.id+'">ブラウザで開く</button>'
        +'<button type="button" role="menuitem" data-ticket-action="child" data-ticket="'+t.id+'">子チケット作成</button>'
        +'</span></span>';
      return '<div class="ticket-row'+sel+'" data-id="'+t.id+'" style="padding-left:'+(12+indent)+'px" tabindex="0">'
        +expandBtn
        +'<span class="ticket-id">#'+t.id+'</span>'
        +'<span class="ticket-subject" title="'+esc(t.subject)+'">'+esc(t.subject)+'</span>'
        +'<span class="badges">'+syncBadge+'</span>'
        +actionMenu
        +'</div>';
    }).join('');
    list.querySelectorAll('.ticket-row').forEach(row=>{
      row.addEventListener('click',e=>{
        if(isTicketActionTarget(e.target)) return;
        const id=Number(row.dataset.id);
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

// ── Filter chips ────────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const f = state.settings.filters;
  const chips=[];
  if(f.subjectQuery) chips.push('件名: '+f.subjectQuery);
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
      const editBtn=cm.editableByCurrentUser
        ?'<button class="btn btn-secondary" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'">編集</button>':'';
      return '<div class="comment-card">'
        +'<div class="comment-header"><span class="comment-author">'+esc(cm.authorName)+'</span>'
        +(cm.updatedAt?'<span class="comment-date">'+esc(cm.updatedAt.substring(0,10))+'</span>':'')
        +'</div>'
        +'<div class="comment-body">'+esc(cm.body)+'</div>'
        +(editBtn?'<div class="comment-actions">'+editBtn+'</div>':'')
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
}

// ── Settings ────────────────────────────────────────────────────────────────
function renderSettings(){
  if(!state) return;
  const s=state.settings;
  const el=document.getElementById('settings-content');
  el.innerHTML=
    '<div class="settings-section"><h3>チケットフィルター</h3>'
    +'<div class="setting-row"><span class="setting-label">件名検索</span>'
    +'<input class="setting-input" id="set-subject" type="text" value="'+esc(s.filters.subjectQuery||'')+'" placeholder="キーワード…"></div>'
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
    +'<div class="settings-section"><h3>一般</h3>'
    +'<div class="setting-row"><span class="setting-label">オフライン同期モード</span>'
    +'<select class="setting-select" id="set-sync-mode">'
    +'<option value="auto"'+(s.offlineSyncMode==="auto"?' selected':'')+'>自動</option>'
    +'<option value="manual"'+(s.offlineSyncMode==="manual"?' selected':'')+'>手動</option>'
    +'</select></div>'
    +'</div>';

  const applyTicketListPatch=(patch)=>req('settings.update',{patch});

  const subjectEl=document.getElementById('set-subject');
  subjectEl.addEventListener('change',()=>applyTicketListPatch({filters:{...s.filters,subjectQuery:subjectEl.value}}));

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
