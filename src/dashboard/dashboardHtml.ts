/** Dashboard Webview HTML/CSS/JS を生成する */
export const buildDashboardHtml = (nonce: string): string => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
/* ── Design tokens ─────────────────────────────────────────── */
:root{
  --c-bg:#fff;
  --c-bg-card:#f8f9fb;
  --c-bg-hover:#f0f4ff;
  --c-bg-selected:#e8efff;
  --c-text:#222;
  --c-text2:#45515e;
  --c-muted:#8e8e93;
  --c-border:#e2e6ec;
  --c-blue:#1456f0;
  --c-blue-hover:#2563eb;
  --c-blue-light:#e8efff;
  --c-success:#22c55e;
  --c-warn:#f59e0b;
  --c-error:#ef4444;
  --c-pink:#ea5ec1;
  --radius-card:14px;
  --radius-pill:9999px;
  --radius-btn:8px;
  --shadow-card:0 1px 4px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04);
  --font-ui:'DM Sans','Noto Sans JP',system-ui,-apple-system,sans-serif;
  --font-display:'Outfit','DM Sans',sans-serif;
}
/* VS Code dark theme override */
@media (prefers-color-scheme:dark){
  :root{
    --c-bg:#1a1d23;
    --c-bg-card:#22262e;
    --c-bg-hover:#2a2f3a;
    --c-bg-selected:#1a2744;
    --c-text:#e8eaed;
    --c-text2:#9aa3b2;
    --c-muted:#6b7280;
    --c-border:#2e3340;
    --shadow-card:0 1px 4px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.2);
  }
}
/* VS Code variables override design tokens when available */
body{
  --c-bg: var(--vscode-sideBar-background,var(--c-bg));
  --c-text: var(--vscode-foreground,var(--c-text));
  --c-text2: var(--vscode-descriptionForeground,var(--c-text2));
  --c-border: var(--vscode-panel-border,var(--c-border));
}
/* ── Reset ─────────────────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font-ui);
  font-size:13px;
  color:var(--c-text);
  background:var(--c-bg);
  height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
/* ── Header ────────────────────────────────────────────────── */
#header{
  padding:10px 12px 8px;
  border-bottom:1px solid var(--c-border);
  flex-shrink:0;
}
#header h1{
  font-family:var(--font-display);
  font-size:14px;
  font-weight:600;
  color:var(--c-text);
  letter-spacing:-.01em;
  margin-bottom:8px;
}
#header-row{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.project-select{
  flex:1;
  min-width:0;
  padding:4px 8px;
  background:var(--vscode-dropdown-background,var(--c-bg-card));
  color:var(--vscode-dropdown-foreground,var(--c-text));
  border:1px solid var(--c-border);
  border-radius:var(--radius-btn);
  font:inherit;
  font-size:12px;
  cursor:pointer;
  max-width:180px;
}
.toggle-children{
  display:flex;
  align-items:center;
  gap:4px;
  font-size:11.5px;
  color:var(--c-text2);
  cursor:pointer;
  user-select:none;
  white-space:nowrap;
}
.toggle-children input{accent-color:var(--c-blue)}
.btn-icon{
  width:26px;
  height:26px;
  display:flex;
  align-items:center;
  justify-content:center;
  border:none;
  background:transparent;
  color:var(--c-text2);
  border-radius:var(--radius-btn);
  cursor:pointer;
  font-size:15px;
  flex-shrink:0;
  transition:background .15s;
}
.btn-icon:hover{background:var(--c-bg-hover);color:var(--c-blue)}
/* ── Tab bar ───────────────────────────────────────────────── */
#tabs{
  display:flex;
  gap:4px;
  padding:8px 12px 0;
  border-bottom:1px solid var(--c-border);
  flex-shrink:0;
  overflow-x:auto;
  scrollbar-width:none;
}
#tabs::-webkit-scrollbar{display:none}
.tab{
  padding:6px 14px;
  border-radius:var(--radius-pill) var(--radius-pill) 0 0;
  font-size:12px;
  font-weight:500;
  color:var(--c-text2);
  cursor:pointer;
  border:1px solid transparent;
  border-bottom:none;
  white-space:nowrap;
  user-select:none;
  transition:background .15s,color .15s;
  position:relative;
  display:flex;
  align-items:center;
  gap:5px;
}
.tab:hover{background:var(--c-bg-hover);color:var(--c-blue)}
.tab.active{
  background:var(--c-bg);
  color:var(--c-blue);
  border-color:var(--c-border);
  margin-bottom:-1px;
  z-index:1;
}
.tab-badge{
  min-width:16px;
  height:16px;
  padding:0 4px;
  border-radius:var(--radius-pill);
  background:var(--c-blue);
  color:#fff;
  font-size:10px;
  font-weight:600;
  display:flex;
  align-items:center;
  justify-content:center;
}
/* ── Content ───────────────────────────────────────────────── */
#content{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.tab-panel{display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0}
.tab-panel.active{display:flex}
/* ── Search / filter bar (Tickets tab) ─────────────────────── */
#filter-bar{
  padding:8px 12px;
  border-bottom:1px solid var(--c-border);
  flex-shrink:0;
}
#search-row{display:flex;gap:6px;align-items:center}
#search-input{
  flex:1;
  padding:5px 10px;
  background:var(--vscode-input-background,var(--c-bg-card));
  color:var(--vscode-input-foreground,var(--c-text));
  border:1px solid var(--c-border);
  border-radius:var(--radius-pill);
  font:inherit;
  font-size:12px;
  outline:none;
  transition:border .15s;
}
#search-input:focus{border-color:var(--c-blue)}
#search-input::placeholder{color:var(--c-muted)}
#filter-chips{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  margin-top:6px;
}
.filter-chip{
  display:flex;
  align-items:center;
  gap:4px;
  padding:2px 8px 2px 10px;
  background:var(--c-blue-light);
  color:var(--c-blue);
  border-radius:var(--radius-pill);
  font-size:11px;
  font-weight:500;
  cursor:pointer;
  border:1px solid transparent;
}
.filter-chip:hover{border-color:var(--c-blue)}
.filter-chip-x{
  font-size:12px;
  line-height:1;
  opacity:.7;
  margin-left:2px;
}
/* ── Ticket list ───────────────────────────────────────────── */
#ticket-scroll{flex:1;overflow-y:auto;min-height:0}
.ticket-row{
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  cursor:pointer;
  border-bottom:1px solid var(--c-border);
  transition:background .1s;
}
.ticket-row:hover{background:var(--c-bg-hover)}
.ticket-row.selected{background:var(--c-bg-selected)}
.ticket-indent{width:0;flex-shrink:0}
.ticket-id{
  font-size:11px;
  color:var(--c-muted);
  white-space:nowrap;
  flex-shrink:0;
  min-width:38px;
}
.ticket-subject{
  flex:1;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:12.5px;
}
.badges{display:flex;gap:3px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
.badge{
  padding:2px 7px;
  border-radius:var(--radius-pill);
  font-size:10.5px;
  font-weight:500;
  white-space:nowrap;
  background:var(--c-bg-card);
  color:var(--c-text2);
  border:1px solid var(--c-border);
}
.badge.priority-high{background:#fff0f0;color:#c0392b;border-color:#fca5a5}
.badge.priority-low{background:#f0fff4;color:#15803d;border-color:#86efac}
.badge.sync-dirty{background:#fff7ed;color:#b45309;border-color:#fcd34d}
.badge.sync-queued{background:#eff6ff;color:var(--c-blue);border-color:#bfdbfe}
.badge.sync-conflict{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.badge.sync-failed{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.badge.sync-syncing{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
.load-more-row{
  padding:10px 12px;
  text-align:center;
  color:var(--c-blue);
  font-size:12px;
  cursor:pointer;
  font-weight:500;
}
.load-more-row:hover{text-decoration:underline}
/* ── Selected ticket detail ────────────────────────────────── */
#detail-card{
  border-top:1px solid var(--c-border);
  padding:10px 12px;
  flex-shrink:0;
  max-height:200px;
  overflow-y:auto;
  background:var(--c-bg-card);
}
.detail-title{
  font-size:13px;
  font-weight:600;
  color:var(--c-text);
  margin-bottom:6px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.detail-meta{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  margin-bottom:8px;
}
.detail-actions{display:flex;gap:6px;flex-wrap:wrap}
.btn{
  padding:4px 12px;
  border-radius:var(--radius-btn);
  font-size:11.5px;
  font-weight:500;
  cursor:pointer;
  border:none;
  transition:background .15s;
}
.btn-primary{background:var(--c-blue);color:#fff}
.btn-primary:hover{background:var(--c-blue-hover)}
.btn-secondary{
  background:transparent;
  color:var(--c-text2);
  border:1px solid var(--c-border);
}
.btn-secondary:hover{background:var(--c-bg-hover);color:var(--c-blue)}
/* ── Unsynced tab ──────────────────────────────────────────── */
#unsynced-panel{padding:8px 12px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}
.unsynced-card{
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px 10px;
  background:var(--c-bg-card);
  border:1px solid var(--c-border);
  border-radius:var(--radius-card);
  box-shadow:var(--shadow-card);
}
.unsynced-icon{font-size:16px;flex-shrink:0}
.unsynced-body{flex:1;min-width:0}
.unsynced-label{font-size:12.5px;font-weight:500;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unsynced-detail{font-size:11px;color:var(--c-muted);margin-top:1px}
.unsynced-actions{display:flex;gap:4px;flex-shrink:0}
#sync-all-btn{
  width:100%;
  padding:8px;
  margin-bottom:8px;
  background:var(--c-blue);
  color:#fff;
  border:none;
  border-radius:var(--radius-btn);
  font:inherit;
  font-size:12.5px;
  font-weight:600;
  cursor:pointer;
  transition:background .15s;
}
#sync-all-btn:hover{background:var(--c-blue-hover)}
/* ── Comments tab ──────────────────────────────────────────── */
#comments-panel{padding:8px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.comment-card{
  padding:10px 12px;
  background:var(--c-bg-card);
  border:1px solid var(--c-border);
  border-radius:var(--radius-card);
  box-shadow:var(--shadow-card);
}
.comment-header{
  display:flex;
  justify-content:space-between;
  margin-bottom:6px;
}
.comment-author{font-size:12px;font-weight:600;color:var(--c-text)}
.comment-date{font-size:11px;color:var(--c-muted)}
.comment-body{font-size:12px;color:var(--c-text2);white-space:pre-wrap;word-break:break-word}
.comment-actions{margin-top:6px;display:flex;gap:4px}
/* ── Settings tab ──────────────────────────────────────────── */
#settings-panel{padding:12px;overflow-y:auto}
.settings-section{margin-bottom:16px}
.settings-section h3{
  font-size:11.5px;
  font-weight:600;
  color:var(--c-muted);
  text-transform:uppercase;
  letter-spacing:.06em;
  margin-bottom:8px;
}
.setting-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:6px 0;
  border-bottom:1px solid var(--c-border);
  font-size:12.5px;
  gap:8px;
}
.setting-label{color:var(--c-text);font-weight:500}
.setting-value{color:var(--c-text2);font-size:11.5px}
.settings-reset-btn{
  width:100%;
  margin-top:12px;
  padding:7px;
  border:1px solid var(--c-border);
  border-radius:var(--radius-btn);
  background:transparent;
  color:var(--c-text2);
  font:inherit;
  font-size:12px;
  cursor:pointer;
}
.settings-reset-btn:hover{background:var(--c-bg-hover);color:var(--c-error)}
/* ── Empty / loading / error states ────────────────────────── */
.state-msg{
  padding:24px 16px;
  text-align:center;
  color:var(--c-muted);
  font-size:12.5px;
  line-height:1.6;
}
.state-msg strong{display:block;font-size:14px;font-weight:600;color:var(--c-text2);margin-bottom:4px}
.error-msg{color:var(--c-error)}
/* ── Scrollbar ─────────────────────────────────────────────── */
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--c-border);border-radius:var(--radius-pill)}
</style>
</head>
<body>

<div id="header">
  <h1>Redmine Dashboard</h1>
  <div id="header-row">
    <select class="project-select" id="project-select" title="Select project">
      <option value="">— Select project —</option>
    </select>
    <label class="toggle-children">
      <input type="checkbox" id="include-children"> Children
    </label>
    <button class="btn-icon" id="refresh-btn" title="Refresh">↻</button>
    <button class="btn btn-primary" id="new-ticket-btn" title="New Ticket">+ New</button>
  </div>
</div>

<div id="tabs">
  <div class="tab active" data-tab="tickets">Tickets</div>
  <div class="tab" data-tab="unsynced">Unsynced <span class="tab-badge" id="unsynced-badge" style="display:none">0</span></div>
  <div class="tab" data-tab="comments">Comments</div>
  <div class="tab" data-tab="settings">Settings</div>
</div>

<div id="content">

  <!-- TICKETS TAB -->
  <div class="tab-panel active" id="panel-tickets">
    <div id="filter-bar">
      <div id="search-row">
        <input id="search-input" type="text" placeholder="Search tickets…" autocomplete="off">
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
      <button id="sync-all-btn" style="display:none">⬆ Sync All</button>
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
      <button class="settings-reset-btn" id="settings-reset-btn">Reset all settings</button>
    </div>
  </div>

</div>

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
    list.innerHTML='<div class="state-msg"><strong>No project selected</strong>Select a project above to view tickets.</div>';
    return;
  }
  if(state.loading.tickets){
    list.innerHTML='<div class="state-msg">Loading tickets…</div>';
    return;
  }
  if(state.errors.tickets){
    list.innerHTML='<div class="state-msg error-msg"><strong>Error</strong>'+esc(state.errors.tickets)+'</div>';
    return;
  }
  const flat = flattenNodes(state.tickets).filter(matchesSearch);
  if(!flat.length){
    list.innerHTML='<div class="state-msg">No tickets match the current filter.</div>';
  } else {
    list.innerHTML = flat.map(t=>{
      const indent = t.level*14;
      const sel = t.id===state.selectedTicketId?' selected':'';
      const syncCls = syncBadgeClass(t.syncState);
      const syncBadge = (t.syncState&&t.syncState!=='Synced')?'<span class="badge '+syncCls+'">'+esc(t.syncState)+'</span>':'';
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
    lm.textContent='Load more… ('+state.loadedTicketCount+' / '+state.totalTicketCount+')';
    lm.onclick=()=>req('tickets.loadMore');
  } else { lm.style.display='none'; }
}

// ── Detail card ──────────────────────────────────────────────────────────────
function renderDetail(){
  if(!state) return;
  const card = document.getElementById('detail-card');
  const t = state.selectedTicket;
  if(!t){ card.style.display='none'; return; }
  card.style.display='block';
  const syncCls = syncBadgeClass(t.syncState);
  const syncBadge = (t.syncState&&t.syncState!=='Synced')?'<span class="badge '+syncCls+'">'+esc(t.syncState)+'</span>':'';
  card.innerHTML=
    '<div class="detail-title">#'+t.id+' '+esc(t.subject)+'</div>'
    +'<div class="detail-meta">'
    +(t.statusName?'<span class="badge">'+esc(t.statusName)+'</span>':'')
    +(t.priorityName?'<span class="badge">'+esc(t.priorityName)+'</span>':'')
    +(t.trackerName?'<span class="badge">'+esc(t.trackerName)+'</span>':'')
    +(t.assigneeName?'<span class="badge">'+esc(t.assigneeName)+'</span>':'')
    +(t.dueDate?'<span class="badge">Due: '+esc(t.dueDate)+'</span>':'')
    +syncBadge
    +'</div>'
    +'<div class="detail-actions">'
    +'<button class="btn btn-primary" id="d-open">Open Editor</button>'
    +'<button class="btn btn-secondary" id="d-comment">Add Comment</button>'
    +'<button class="btn btn-secondary" id="d-browser">Browser</button>'
    +'<button class="btn btn-secondary" id="d-child">Child</button>'
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
  if(f.subjectQuery) chips.push(['Subject: '+f.subjectQuery,'subjectQuery','']);
  // Add more chip types as needed
  const el=document.getElementById('filter-chips');
  el.innerHTML=chips.map(([label])=>'<span class="filter-chip">'+esc(label)+'<span class="filter-chip-x">×</span></span>').join('');
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
  if(!n){ list.innerHTML='<div class="state-msg">No local changes.</div>'; return; }
  const iconMap={ticket:'📝',newTicket:'✨',comment:'💬'};
  list.innerHTML=state.unsynced.items.map(item=>{
    const icon=iconMap[item.key.kind]||'📄';
    const openBtn=item.documentUri?'<button class="btn btn-secondary" data-uri="'+esc(item.documentUri)+'">Open</button>':'';
    return '<div class="unsynced-card">'
      +'<span class="unsynced-icon">'+icon+'</span>'
      +'<div class="unsynced-body">'
      +'<div class="unsynced-label">'+esc(item.label)+'</div>'
      +(item.detail?'<div class="unsynced-detail">'+esc(item.detail)+'</div>':'')
      +'</div>'
      +'<div class="unsynced-actions">'
      +openBtn
      +'<button class="btn btn-primary" data-sync-key="'+esc(JSON.stringify(item.key))+'">Sync</button>'
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
}

// ── Comments ────────────────────────────────────────────────────────────────
function renderComments(){
  if(!state) return;
  const c=state.comments;
  const list=document.getElementById('comments-list');
  const ticketId=state.selectedTicketId;
  const header=ticketId
    ?'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      +'<span style="font-size:12px;font-weight:600;color:var(--c-text2)">Comments for #'+ticketId+'</span>'
      +'<div style="display:flex;gap:4px">'
      +'<button class="btn btn-primary" id="add-comment-btn">+ Add</button>'
      +'<button class="btn btn-secondary" id="reload-comments-btn">↻</button>'
      +'</div></div>'
    :'';
  if(!ticketId){ list.innerHTML='<div class="state-msg">Select a ticket to view comments.</div>'; return; }
  if(c.loading){ list.innerHTML=header+'<div class="state-msg">Loading comments…</div>'; }
  else if(c.error){ list.innerHTML=header+'<div class="state-msg error-msg">'+esc(c.error)+'</div>'; }
  else if(!c.items.length){ list.innerHTML=header+'<div class="state-msg">No comments.</div>'; }
  else{
    list.innerHTML=header+c.items.map(cm=>{
      const editBtn=cm.editableByCurrentUser
        ?'<button class="btn btn-secondary" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'">Edit</button>':'';
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
    '<div class="settings-section"><h3>Ticket Filters</h3>'
    +'<div class="setting-row"><span class="setting-label">Subject search</span>'
    +'<input class="setting-input" id="set-subject" type="text" value="'+esc(s.filters.subjectQuery||'')+'" placeholder="Keyword…"></div>'
    +'</div>'
    +'<div class="settings-section"><h3>Sort</h3>'
    +'<div class="setting-row"><span class="setting-label">Sort field</span>'
    +'<select class="setting-select" id="set-sort-field">'
    +'<option value=""'+(s.sort.field?'':' selected')+'>Default</option>'
    +'<option value="priority"'+(s.sort.field==="priority"?' selected':'')+'>Priority</option>'
    +'<option value="status"'+(s.sort.field==="status"?' selected':'')+'>Status</option>'
    +'<option value="tracker"'+(s.sort.field==="tracker"?' selected':'')+'>Tracker</option>'
    +'<option value="assignee"'+(s.sort.field==="assignee"?' selected':'')+'>Assignee</option>'
    +'</select></div>'
    +'<div class="setting-row"><span class="setting-label">Direction</span>'
    +'<select class="setting-select" id="set-sort-dir">'
    +'<option value="asc"'+(s.sort.direction==="asc"?' selected':'')+'>Ascending</option>'
    +'<option value="desc"'+(s.sort.direction==="desc"?' selected':'')+'>Descending</option>'
    +'</select></div>'
    +'</div>'
    +'<div class="settings-section"><h3>Due Date Indicators</h3>'
    +'<div class="setting-row"><span class="setting-label">Overdue</span><input type="checkbox" id="set-dd-overdue"'+(s.dueDate.showOverdue?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">Within 1 day</span><input type="checkbox" id="set-dd-1d"'+(s.dueDate.showWithin1Day?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">Within 3 days</span><input type="checkbox" id="set-dd-3d"'+(s.dueDate.showWithin3Days?' checked':'')+' class="setting-check"></div>'
    +'<div class="setting-row"><span class="setting-label">Within 7 days</span><input type="checkbox" id="set-dd-7d"'+(s.dueDate.showWithin7Days?' checked':'')+' class="setting-check"></div>'
    +'</div>'
    +'<div class="settings-section"><h3>General</h3>'
    +'<div class="setting-row"><span class="setting-label">Offline sync mode</span>'
    +'<select class="setting-select" id="set-sync-mode">'
    +'<option value="auto"'+(s.offlineSyncMode==="auto"?' selected':'')+'>Auto</option>'
    +'<option value="manual"'+(s.offlineSyncMode==="manual"?' selected':'')+'>Manual</option>'
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
  // Populate project selector from state.projects list
  const sel=document.getElementById('project-select');
  const currentVal=sel.value;
  // Clear all options except placeholder
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
}

// ── Messages from extension ──────────────────────────────────────────────────
window.addEventListener('message',event=>{
  const msg=event.data;
  if(msg.type==='dashboard.state'){
    state=msg.state;
    render();
  } else if(msg.type==='toast'){
    // Could show a toast — for now just log
    console.log('[Dashboard]',msg.level,msg.message);
  }
});

// ── Ready ────────────────────────────────────────────────────────────────────
req('dashboard.ready');
}());
</script>
</body>
</html>`;
