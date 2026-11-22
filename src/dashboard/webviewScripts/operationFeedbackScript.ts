export const operationFeedbackScript = String.raw`// ── Operation feedback ────────────────────────────────────────────────────
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
function updateRefreshButtonState(){
  const button = document.getElementById('refresh-btn');
  if(!button) return;
  const spinning = activeRefreshRequests.size > 0;
  button.classList.toggle('is-spinning', spinning);
  button.setAttribute('aria-busy', String(spinning));
  button.title = spinning ? STRINGS.refreshing : STRINGS.refresh;
}
function updateSyncButtonStates(){
  const busy = activeSyncRequests.size > 0;
  const selectedSyncing = state?.selectedTicket?.syncState === 'Syncing' || Array.from(ticketSyncRequests.values()).includes(state?.selectedTicket?.id);
  document.querySelectorAll('[data-sync-key],[data-discard-key],[data-discard-pending-id],[data-comment-action="sync"],[data-abandon-key],[data-forget-key],#forget-all-abandoned-btn,[data-start-ticket],[data-ticket-action="sync"],[data-draft-action="sync"]').forEach(function(button){
    const ticketId = Number(button.dataset.ticket);
    const isSelectedSyncing = Number.isInteger(ticketId) && ticketId > 0 && ticketId === state?.selectedTicket?.id && selectedSyncing;
    button.disabled = busy || isSelectedSyncing || !!button.closest('[data-sync-in-progress="true"]');
  });
  const syncAll = document.getElementById('sync-all-btn');
  if(syncAll){ const syncing = busy || !!state?.unsynced.items.some(item=>item.inProgress); syncAll.disabled = syncing; syncAll.setAttribute('aria-busy', String(syncing)); }
}
function startOperation(requestId, label){
  if(activeRefreshRequests.has(requestId)){ updateRefreshButtonState(); return; }
  activeSyncRequests.add(requestId);
  if(unsyncedFeedbackRequests.has(requestId)) setOperationFeedback('info', label || STRINGS.syncSyncing);
  updateSyncButtonStates();
}
function endOperation(requestId){ ticketSyncRequests.delete(requestId); activeSyncRequests.delete(requestId); activeRefreshRequests.delete(requestId); updateSyncButtonStates(); updateRefreshButtonState(); }
function finishOperation(level, requestId, message){
  const handled=unsyncedFeedbackRequests.delete(requestId);
  if(handled) setOperationFeedback(level, message);
  return handled && !document.getElementById('panel-unsynced').hidden;
}
`;
