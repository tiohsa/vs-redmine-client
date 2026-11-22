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
    const isSelected=cm.id !== undefined
      ? comments.selectedCommentId === cm.id
      : !!(cm.syncKey?.documentUri && comments.selectedCommentUri === cm.syncKey.documentUri);
    const unsynced=cm.isEditing ? '<span class="unsynced-inline-badge"><span class="unsynced-dot" aria-hidden="true"></span>'+esc(STRINGS.syncEditing)+'</span>' : cm.hasUnsyncedEdit ? '<span class="unsynced-inline-badge"><span class="unsynced-dot" aria-hidden="true"></span>'+esc(STRINGS.unsyncedEditBadge)+'</span>' : '';
    const canSync=cm.id !== undefined || !!cm.syncKey?.documentUri;
    const syncBtn=canSync
      ? '<button class="comment-action-btn comment-hover-action-btn" type="button" data-comment-action="sync" data-ticket="'+ticketId+'"'+(cm.id !== undefined ? ' data-comment-id="'+cm.id+'"' : '')+(cm.id === undefined && cm.syncKey?.documentUri ? ' data-comment-uri="'+esc(cm.syncKey.documentUri)+'"' : '')+' title="'+esc(STRINGS.syncToRedmine)+'" aria-label="'+esc(STRINGS.syncToRedmine)+'">'+actionIcon('sync')+'</button>'
      : '';
    const browserBtn=cm.id !== undefined
      ? '<button class="comment-action-btn comment-hover-action-btn" type="button" data-comment-action="browser" data-ticket="'+ticketId+'" data-comment-id="'+cm.id+'"'+(cm.noteIndex !== undefined ? ' data-note-index="'+cm.noteIndex+'"' : '')+' title="'+esc(STRINGS.openInBrowser)+'" aria-label="'+esc(STRINGS.openInBrowser)+'">'+actionIcon('browser')+'</button>'
      : '';
    const deleteBtn=cm.id !== undefined
      ? '<button class="comment-action-btn comment-hover-action-btn" type="button" data-comment-action="delete" data-ticket="'+ticketId+'" data-comment-id="'+cm.id+'" data-connection-generation="'+state.connectionGeneration+'" title="'+esc(STRINGS.deleteAction)+'" aria-label="'+esc(STRINGS.deleteAction)+'">'+actionIcon('delete')+'</button>'
      : '';
    const hoverActions=(syncBtn || browserBtn || deleteBtn) ? '<div class="comment-hover-actions">'+syncBtn+browserBtn+deleteBtn+'</div>' : '';
    const journalId=cm.id?'<span class="comment-id">#'+cm.id+'</span>':'';
    const date=cm.updatedAt?'<time class="comment-date" title="'+esc(cm.updatedAt)+'">'+esc(cm.updatedAt.substring(0,16).replace('T',' '))+'</time>':'';
    const cardIdentityAttrs=(cm.id !== undefined ? ' data-comment-id="'+cm.id+'"' : (cm.syncKey?.documentUri ? ' data-comment-uri="'+esc(cm.syncKey.documentUri)+'"' : ''));
    return '<article class="comment-card'+(editable?' is-editable':'')+(isSelected?' selected':'')+'" role="listitem" aria-current="'+isSelected+'" tabindex="0"'+cardIdentityAttrs+(editable?' data-editable-comment="'+cm.id+'" data-ticket="'+ticketId+'"':'')+'><div class="comment-header"><div class="comment-meta"><span class="comment-author">'+esc(cm.authorName)+'</span>'+date+journalId+unsynced+'</div></div><div class="comment-body">'+esc(cm.body)+'</div>'+hoverActions+'</article>';
  }).join('')+'</div>';
  list.innerHTML=content;
  list.querySelectorAll('[data-editable-comment]').forEach(function(card){
    card.addEventListener('click',function(event){
      if(isElement(event.target) && event.target.closest('.comment-hover-actions,[data-comment-action]')) return;
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
  list.querySelectorAll('[data-comment-action]').forEach(function(btn){
    btn.addEventListener('click',function(event){
      event.stopPropagation();
      const action=btn.dataset.commentAction;
      const targetTicketId=Number(btn.dataset.ticket);
      if(action === 'sync'){
        const payload={ticketId:targetTicketId};
        if(btn.dataset.commentId) payload.commentId=Number(btn.dataset.commentId);
        else if(btn.dataset.commentUri) payload.documentUri=btn.dataset.commentUri;
        req('comment.syncSelected',payload);
      } else if(action === 'delete'){
        req('deleteComment',{ticketId:targetTicketId,commentId:Number(btn.dataset.commentId),connectionGeneration:Number(btn.dataset.connectionGeneration)});
      } else if(action === 'browser'){
        const payload={ticketId:targetTicketId,commentId:Number(btn.dataset.commentId)};
        if(btn.dataset.noteIndex) payload.noteIndex=Number(btn.dataset.noteIndex);
        req('comment.openBrowser',payload);
      }
    });
  });
  updateSyncButtonStates();
}

`;
