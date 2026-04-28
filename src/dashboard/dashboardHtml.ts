import { dashboardStyles } from "./dashboardStyles";

/** Dashboard Webview HTML/CSS/JS を生成する */
export const buildDashboardHtml = (nonce: string): string => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${dashboardStyles}
</style>
</head>
<body>

<div id="header">
  <h1>Redmine ダッシュボード</h1>
  <div id="header-row">
    <select class="project-select" id="project-select" title="プロジェクトを選択">
      <option value="">— プロジェクトを選択 —</option>
    </select>
    <label class="toggle-children">
      <input type="checkbox" id="include-children"> 子を含める
    </label>
    <button class="btn-icon" id="refresh-btn" title="更新">↻</button>
    <button class="btn btn-primary" id="new-ticket-btn" title="新規チケット">新規チケット</button>
  </div>
</div>

<div id="tabs">
  <div class="tab active" data-tab="tickets">チケット</div>
  <div class="tab" data-tab="unsynced">未同期 <span class="tab-badge" id="unsynced-badge" style="display:none">0</span></div>
  <div class="tab" data-tab="comments">コメント</div>
  <div class="tab" data-tab="settings">設定</div>
</div>

<div id="content">

  <!-- TICKETS TAB -->
  <div class="tab-panel active" id="panel-tickets">
    <div id="filter-bar">
      <div id="search-row">
        <input id="search-input" type="text" placeholder="チケットを検索…" autocomplete="off">
      </div>
      <div id="filter-chips"></div>
    </div>
    <div id="ticket-scroll">
      <div id="ticket-list"></div>
      <div id="load-more-row" class="load-more-row" style="display:none"></div>
    </div>
    <div id="detail-card" style="display:none"></div>
  </div>

  <!-- UNSYNCED TAB -->
  <div class="tab-panel" id="panel-unsynced">
    <div id="unsynced-panel">
      <button id="sync-all-btn" style="display:none">⬆ すべて同期</button>
      <div id="unsynced-list"></div>
    </div>
  </div>

  <!-- COMMENTS TAB -->
  <div class="tab-panel" id="panel-comments">
    <div id="comments-panel">
      <div id="comments-list"></div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div class="tab-panel" id="panel-settings">
    <div id="settings-panel">
      <div id="settings-content"></div>
      <button class="settings-reset-btn" id="settings-reset-btn">設定をリセット</button>
    </div>
  </div>

</div>

<div id="toast-area"></div>

<script nonce="${nonce}">
(function(){
'use strict';
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let state = null;
let reqCounter = 0;
const nextReqId = () => 'req-' + (++reqCounter);

// ── Utils ──────────────────────────────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function send(msg){ vscode.postMessage(msg); }
function req(type, extra){ send({type, requestId:nextReqId(), ...extra}); }

// ── Toast / operation feedback ─────────────────────────────────────────────
const activeSyncRequests = new Set();

function showToast(level, message){
  const area = document.getElementById('toast-area');
  const el = document.createElement('div');
  el.className = 'toast toast-' + level;
  el.textContent = message;
  area.appendChild(el);
  // フェードアウト
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
  document.querySelectorAll('[data-sync-key]').forEach(btn => { btn.disabled = busy; });
  const syncAll = document.getElementById('sync-all-btn');
  if (syncAll) syncAll.disabled = busy;
}

// ── Tabs ───────────────────────────────────────────────────────────────────
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
function activateTab(name){
  tabs.forEach(t=>{ t.classList.toggle('active', t.dataset.tab===name); });
  panels.forEach(p=>{ p.classList.toggle('active', p.id==='panel-'+name); });
}
tabs.forEach(t=>{ t.addEventListener('click',()=>activateTab(t.dataset.tab)); });

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

// ── Ticket rendering ────────────────────────────────────────────────────────
function flattenNodes(nodes, result=[]){
  for(const n of nodes){ result.push(n); if(n.children?.length) flattenNodes(n.children,result); }
  return result;
}
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
  const flat = flattenNodes(state.tickets).filter(matchesSearch);
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
      const priCls = t.priorityName?.toLowerCase().includes('high')?'priority-high':t.priorityName?.toLowerCase().includes('low')?'priority-low':'';
      const priBadge = t.priorityName?'<span class="badge '+priCls+'">'+esc(t.priorityName)+'</span>':'';
      const stBadge = t.statusName?'<span class="badge">'+esc(t.statusName)+'</span>':'';
      return '<div class="ticket-row'+sel+'" data-id="'+t.id+'" style="padding-left:'+(12+indent)+'px" tabindex="0">'
        +'<span class="ticket-id">#'+t.id+'</span>'
        +'<span class="ticket-subject" title="'+esc(t.subject)+'">'+esc(t.subject)+'</span>'
        +'<span class="badges">'+priBadge+stBadge+syncBadge+'</span>'
        +'</div>';
    }).join('');
    list.querySelectorAll('.ticket-row').forEach(row=>{
      row.addEventListener('click',()=>{
        const id=Number(row.dataset.id);
        req('ticket.select',{ticketId:id});
      });
      row.addEventListener('keydown',e=>{ if(e.key==='Enter') row.click(); });
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

// ── Detail card ──────────────────────────────────────────────────────────────
function renderDetail(){
  if(!state) return;
  const card = document.getElementById('detail-card');
  const t = state.selectedTicket;
  if(!t){ card.style.display='none'; return; }
  card.style.display='block';
  const syncCls = syncBadgeClass(t.syncState);
  const syncLabel = SYNC_LABEL[t.syncState] || t.syncState;
  const syncBadge = (t.syncState&&t.syncState!=='Synced')
    ?'<span class="badge '+syncCls+'">'+esc(syncLabel)+'</span>':'';
  card.innerHTML=
    '<div class="detail-title">#'+t.id+' '+esc(t.subject)+'</div>'
    +'<div class="detail-meta">'
    +(t.statusName?'<span class="badge">'+esc(t.statusName)+'</span>':'')
    +(t.priorityName?'<span class="badge">'+esc(t.priorityName)+'</span>':'')
    +(t.trackerName?'<span class="badge">'+esc(t.trackerName)+'</span>':'')
    +(t.assigneeName?'<span class="badge">'+esc(t.assigneeName)+'</span>':'')
    +(t.dueDate?'<span class="badge">期日: '+esc(t.dueDate)+'</span>':'')
    +syncBadge
    +'</div>'
    +'<div class="detail-actions">'
    +'<button class="btn btn-primary" id="d-open">エディタで開く</button>'
    +'<button class="btn btn-secondary" id="d-comment">コメント追加</button>'
    +'<button class="btn btn-secondary" id="d-browser">ブラウザで開く</button>'
    +'<button class="btn btn-secondary" id="d-child">子チケット</button>'
    +'</div>';
  card.querySelector('#d-open').onclick=()=>req('ticket.openEditor',{ticketId:t.id});
  card.querySelector('#d-comment').onclick=()=>req('comment.add',{ticketId:t.id});
  card.querySelector('#d-browser').onclick=()=>req('ticket.openBrowser',{ticketId:t.id});
  card.querySelector('#d-child').onclick=()=>req('ticket.createChild',{parentTicketId:t.id});
}

// ── Filter chips ────────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const f = state.settings.filters;
  const chips=[];
  if(f.subjectQuery) chips.push('件名: '+f.subjectQuery);
  const el=document.getElementById('filter-chips');
  el.innerHTML=chips.map(label=>'<span class="filter-chip">'+esc(label)+'<span class="filter-chip-x">×</span></span>').join('');
}

// ── Unsynced ────────────────────────────────────────────────────────────────
function renderUnsynced(){
  if(!state) return;
  const badge=document.getElementById('unsynced-badge');
  const n=state.unsynced.totalCount;
  badge.textContent=String(n);
  badge.style.display=n>0?'flex':'none';

  const syncAllBtn=document.getElementById('sync-all-btn');
  syncAllBtn.style.display=n>0?'block':'none';
  syncAllBtn.onclick=()=>req('unsynced.syncAll');

  const list=document.getElementById('unsynced-list');
  if(!n){ list.innerHTML='<div class="state-msg">未同期の変更はありません。</div>'; updateSyncButtonStates(); return; }
  const iconMap={ticket:'📝',newTicket:'✨',comment:'💬'};
  list.innerHTML=state.unsynced.items.map(item=>{
    const icon=iconMap[item.key.kind]||'📄';
    const openBtn=item.documentUri?'<button class="btn btn-secondary" data-uri="'+esc(item.documentUri)+'">開く</button>':'';
    return '<div class="unsynced-card">'
      +'<span class="unsynced-icon">'+icon+'</span>'
      +'<div class="unsynced-body">'
      +'<div class="unsynced-label">'+esc(item.label)+'</div>'
      +(item.detail?'<div class="unsynced-detail">'+esc(item.detail)+'</div>':'')
      +'</div>'
      +'<div class="unsynced-actions">'
      +openBtn
      +'<button class="btn btn-primary" data-sync-key="'+esc(JSON.stringify(item.key))+'">同期</button>'
      +'</div>'
      +'</div>';
  }).join('');
  list.querySelectorAll('[data-uri]').forEach(btn=>{
    btn.addEventListener('click',()=>req('unsynced.openLocalFile',{documentUri:btn.dataset.uri}));
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
    ?'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      +'<span style="font-size:12px;font-weight:600;color:var(--c-text2)">チケット #'+ticketId+' のコメント</span>'
      +'<div style="display:flex;gap:4px">'
      +'<button class="btn btn-primary" id="add-comment-btn">+ 追加</button>'
      +'<button class="btn btn-secondary" id="reload-comments-btn">↻</button>'
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
  // プロジェクトセレクタ更新
  const sel=document.getElementById('project-select');
  const currentVal=sel.value;
  while(sel.options.length>1) sel.remove(1);
  if(state.projects && state.projects.length>0){
    for(const p of state.projects){
      const opt=document.createElement('option');
      opt.value=String(p.id);
      const indent='  '.repeat(p.level);
      opt.textContent=indent+(p.name||'Project #'+p.id);
      sel.appendChild(opt);
    }
  } else if(state.selectedProject?.id){
    // フォールバック: プロジェクトリスト未ロード時は選択済みプロジェクトのみ表示
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
  renderDetail();
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
}());
</script>
</body>
</html>`;
