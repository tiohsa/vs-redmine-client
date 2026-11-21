export const ticketDetailScript = String.raw`// ── Ticket detail / composer ──────────────────────────────────────────────
function renderTicketDetailPanel(ticket){
  if(renderedDetailTicketId !== ticket.id){ renderedDetailTicketId=ticket.id; }
  const card=document.getElementById('ticket-detail-card');
  const trackerCls=trackerAccentClass(ticket.trackerName);
  card.className='ticket-work-panel ticket-detail-card '+trackerCls;
  card.removeAttribute('aria-busy');
  const commentCount=state.comments.ticketId === ticket.id ? state.comments.items.length : 0;
  card.innerHTML=
    '<div class="detail-header-fixed">'
      +'<div class="detail-head-row1">'
        +'<span class="detail-tracker-bar" aria-hidden="true"'+(ticket.trackerName?' title="'+esc(STRINGS.sortTracker+': '+ticket.trackerName)+'"':'')+'></span>'
        +'<span class="ticket-id">#'+ticket.id+'</span>'
        +'<span class="comments-header-label">'+actionIcon('comment')+'<span>'+esc(STRINGS.tabComments)+'</span><span id="detail-comment-count" class="tab-badge">'+commentCount+'</span></span>'
        +'<span class="sr-only">'+esc(STRINGS.editingState)+'</span>'
        +'<span id="detail-sync-state" role="status" aria-live="polite"></span>'
      +'</div>'
      +'<div class="comments-header-actions">'
        +'<button class="btn btn-primary" id="add-comment-btn" type="button">'+actionIcon('child')+'<span>'+esc(STRINGS.addCommentAction)+'</span></button>'
        +'<button class="btn btn-secondary detail-icon-button" id="reload-comments-btn" type="button" title="'+esc(STRINGS.reloadComments)+'" aria-label="'+esc(STRINGS.reloadComments)+'">'+actionIcon('refresh')+'</button>'
        +'<button class="btn btn-secondary detail-toggle" id="detail-cancel-btn" type="button" title="'+esc(STRINGS.dismissDetail)+'" aria-label="'+esc(STRINGS.dismissDetail)+'">'+actionIcon('cancel')+'</button>'
      +'</div>'
    +'</div>'
    +'<div id="detail-comments" class="detail-comments-panel">'
      +'<div id="comments-list"></div>'
    +'</div>';
  card.querySelector('#detail-cancel-btn').addEventListener('click',function(){ req('ticket.cancelDetail'); });
  card.querySelector('#add-comment-btn').addEventListener('click',function(){ req('comment.add',{ticketId:ticket.id}); });
  card.querySelector('#reload-comments-btn').addEventListener('click',function(){ req('comment.reload',{ticketId:ticket.id}); });
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
  if(!panel){ composerDraftKey=null; composerDraftValues=null; if(!state.selectedTicket){ renderedDetailTicketId=null; card.className='ticket-work-panel ticket-detail-card hidden'; card.innerHTML=''; return; } renderTicketDetailPanel(state.selectedTicket); return; }
  if(panel.mode === 'detail'){ composerDraftKey=null; composerDraftValues=null; if(state.selectedTicket && state.selectedTicket.id === panel.ticketId) renderTicketDetailPanel(state.selectedTicket); else { card.className='ticket-work-panel ticket-detail-card hidden'; card.innerHTML=''; } return; }
  renderComposerPanel(panel);
}

`;
