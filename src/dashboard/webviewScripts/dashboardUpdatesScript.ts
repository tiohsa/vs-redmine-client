export const dashboardUpdatesScript = String.raw`function render(){
  if(!state) return; const focus=captureFocus(document); closeTicketActionMenus(); syncExpandedState(state.tickets);
  renderProjectSelect();
  const includeChildrenBtn = document.getElementById('include-children');
  const includeChildrenWrap = includeChildrenBtn.closest('label');
  const includeChildrenOn = !!state.includeChildProjects;
  includeChildrenBtn.setAttribute('aria-pressed', String(includeChildrenOn));
  includeChildrenBtn.title = includeChildrenOn ? STRINGS.includeChildrenOn : STRINGS.includeChildrenOff;
  includeChildrenBtn.disabled = !state.selectedProject;
  if(includeChildrenWrap) includeChildrenWrap.hidden = !state.selectedProject;
  const ticketsBadge = document.getElementById('tickets-badge');
  if(ticketsBadge){
    const totalTickets = (Number.isFinite(state.totalTicketCount) && state.totalTicketCount > 0 ? state.totalTicketCount : (state.loadedTicketCount || flattenAll(state.tickets).length)) + (state.draftTickets || []).length;
    ticketsBadge.textContent = String(totalTickets);
    ticketsBadge.setAttribute('aria-label', String(totalTickets));
  }
  applyCompactMode();
  updateRefreshButtonState();
  renderTickets(); renderTicketDetail(); renderFilterChips(); renderUnsynced(); renderComments(); renderSettings(); renderSyncTray(); updateSyncButtonStates(); restoreFocus(focus);
}
window.addEventListener('message',function(event){ const message=event.data || {}; if(message.type === 'dashboard.state'){
    const previous=state;
    const projectChanged=previous?.selectedProject?.id !== message.state.selectedProject?.id;
    if(projectChanged){ expandedTicketIds.clear(); collapsedTicketIds.clear(); }
    const connectionChanged=previous?.settings?.baseUrl !== message.state.settings?.baseUrl;
    if(connectionChanged){ closeProjectPicker(false); activeRefreshRequests.clear(); updateRefreshButtonState(); if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; } searchComposing=false; searchQuery=message.state.ticketSearch?.query || ''; searchInput.value=searchQuery; updateSearchClearButton(); }
    const ticketChanged=previous?.selectedTicketId !== message.state.selectedTicketId;
    if(connectionChanged || !message.state.draftTickets?.some(function(draft){ return draft.queueId === selectedDraftId; }) || (ticketChanged && message.state.selectedTicketId !== undefined)) selectedDraftId = null;
    const previousComposer=previous?.workPanel;
    if(!previous && message.state.ticketSearch){ searchQuery=message.state.ticketSearch.query; searchInput.value=searchQuery; updateSearchClearButton(); }
    state=message.state;
    if(previous && projectChanged && !connectionChanged && searchInput.value.trim() !== (state.ticketSearch?.query || '')) scheduleSearch();
    const panel=state.workPanel;
    const openingComposer=panel && panel.mode !== 'detail' && (!previousComposer || previousComposer.mode !== panel.mode || previousComposer.projectId !== panel.projectId);
    if(openingComposer) activateTab('tickets');
    render();
    if(panel && panel.mode !== 'detail' && !panel.loading && (openingComposer || previousComposer?.loading)) document.getElementById('work-tracker')?.focus();
    if(previousComposer?.mode === 'newTicket' && (!panel || panel.mode === 'detail')) document.getElementById('project-select-trigger')?.focus();
  } else if(message.type === 'view.toggleCompactMode'){ compactMode = !compactMode; persistViewState(); applyCompactMode(); } else if(message.type === 'operation.started'){ startOperation(message.requestId,message.label); } else if(message.type === 'operation.success'){ endOperation(message.requestId); if(!finishOperation(message.level || 'success',message.requestId,message.message)) showToast(message.level || 'success',message.message); } else if(message.type === 'operation.error'){ endOperation(message.requestId); if(!finishOperation('error',message.requestId,message.message)) showToast('error',message.message); } else if(message.type === 'toast'){ showToast(message.level,message.message); } });
document.addEventListener('keydown',function(event){
  if(event.defaultPrevented || event.key !== 'Escape') return;
  if(projectPickerOpen || !layoutPopover.classList.contains('hidden') || !filterDialog.classList.contains('hidden') || activeTicketActionMenuId || document.querySelector('details[open].unsynced-more')) return;
  const active=document.activeElement;
  if(active && (active.tagName === 'SELECT' || ((active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.value))) return;
  const panel=state?.workPanel;
  const hasComposer=panel && panel.mode !== 'detail';
  const hasDetail=!!(state?.selectedTicket || panel?.mode === 'detail');
  if(!hasComposer && !hasDetail) return;
  event.preventDefault();
  if(hasComposer) req('ticket.cancelComposer');
  else req('ticket.cancelDetail');
  const selectedRow=document.querySelector('#ticket-list .ticket-row.selected') || document.querySelector('#ticket-list .ticket-row');
  selectedRow?.focus();
});
req('dashboard.ready');
`;
