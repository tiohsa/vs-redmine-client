export const commentsScript = String.raw`// ── Comments ───────────────────────────────────────────────────────────────
function updateCommentExpandButtons(){}
function renderComments(){
  if(!state) return;
  const comments=state.comments;
  const list=document.getElementById('comments-list');
  if(!list) return;
  const ticketId=state.selectedTicketId;
  const countEl=document.getElementById('detail-comment-count');
  if(countEl) countEl.textContent=String(ticketId !== undefined && comments.ticketId === ticketId ? comments.items.length : 0);
  list.setAttribute('aria-busy',String(comments.loading));
  if(ticketId === undefined){ list.innerHTML='<div class="state-msg">'+STRINGS.noTicketSelected+'</div>'; return; }
  if(comments.ticketId !== ticketId){ list.innerHTML='<div class="state-msg">'+esc(STRINGS.loadingComments)+'</div>'; return; }
  let content='';
  if(comments.loading) content='<div class="state-msg">'+STRINGS.loadingComments+'</div>';
  else if(comments.error) content='<div class="state-msg error-msg">'+esc(comments.error)+'</div>';
  else if(!comments.items.length) content='<div class="state-msg">'+STRINGS.noComments+'</div>';
  else content='<div class="comment-list comment-timeline" role="list">'+comments.items.map(function(cm){
    const editable=!!(cm.id && cm.editableByCurrentUser);
    const unsynced=cm.hasUnsyncedEdit ? '<span class="unsynced-inline-badge"><span class="unsynced-dot" aria-hidden="true"></span>'+esc(STRINGS.unsyncedEditBadge)+'</span>' : '';
    const syncBtn=cm.syncKey?'<button class="btn btn-secondary comment-sync-btn" type="button" data-sync-comment-key="'+esc(JSON.stringify(cm.syncKey))+'">'+actionIcon('sync')+esc(STRINGS.syncToRedmine)+'</button>':'';
    const editBtn=editable?'<button class="comment-edit-icon" type="button" data-edit-comment="'+cm.id+'" data-ticket="'+ticketId+'" title="'+esc(STRINGS.openInEditor)+'" aria-label="'+esc(STRINGS.openInEditor)+'">'+actionIcon('open')+'</button>':'';
    const journalId=cm.id?'<span class="comment-id">#'+cm.id+'</span>':'';
    const date=cm.updatedAt?'<time class="comment-date" title="'+esc(cm.updatedAt)+'">'+esc(cm.updatedAt.substring(0,16).replace('T',' '))+'</time>':'';
    return '<article class="comment-card'+(editable?' is-editable':'')+'" role="listitem"'+(editable?' tabindex="0" data-editable-comment="'+cm.id+'" data-ticket="'+ticketId+'"':'')+'><div class="comment-header"><div class="comment-meta"><span class="comment-author">'+esc(cm.authorName)+'</span>'+date+journalId+unsynced+'</div><div class="comment-header-actions">'+editBtn+syncBtn+'</div></div><div class="comment-body">'+esc(cm.body)+'</div></article>';
  }).join('')+'</div>';
  list.innerHTML=content;
  list.querySelectorAll('[data-edit-comment]').forEach(function(button){
    button.addEventListener('click',function(event){
      event.stopPropagation();
      req('comment.edit',{ticketId:Number(button.dataset.ticket),commentId:Number(button.dataset.editComment)});
    });
  });
  list.querySelectorAll('[data-editable-comment]').forEach(function(card){
    card.addEventListener('click',function(event){
      if(isElement(event.target) && event.target.closest('[data-sync-comment-key],[data-edit-comment]')) return;
      req('comment.edit',{ticketId:Number(card.dataset.ticket),commentId:Number(card.dataset.editableComment)});
    });
    card.addEventListener('keydown',function(event){
      if(event.target !== card) return;
      if(event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        req('comment.edit',{ticketId:Number(card.dataset.ticket),commentId:Number(card.dataset.editableComment)});
      }
    });
  });
  list.querySelectorAll('[data-sync-comment-key]').forEach(function(btn){
    btn.addEventListener('click',function(event){
      event.stopPropagation();
      try { req('unsynced.syncOne',{key:JSON.parse(btn.getAttribute('data-sync-comment-key'))}); } catch {}
    });
  });
  updateSyncButtonStates();
}

`;
