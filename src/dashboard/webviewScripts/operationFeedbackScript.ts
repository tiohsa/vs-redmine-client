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
  document.querySelectorAll('[data-sync-key],[data-discard-key],[data-sync-comment-key],[data-abandon-key],[data-forget-key],#forget-all-abandoned-btn,[data-start-ticket],[data-ticket-action="sync"],[data-draft-action="sync"]').forEach(function(button){
    const ticketId = Number(button.dataset.ticket);
    const isSelectedSyncing = Number.isInteger(ticketId) && ticketId > 0 && ticketId === state?.selectedTicket?.id && selectedSyncing;
    button.disabled = busy || isSelectedSyncing;
  });
  const detailState=document.getElementById('detail-sync-state');
  if(detailState && state?.selectedTicket){
    const value=selectedSyncing ? 'Syncing' : state.selectedTicket.syncState;
    const unsynced=!!value && value !== 'Synced';
    detailState.className='detail-sync-state '+syncBadgeClass(value)+(unsynced ? '' : ' hidden');
    detailState.textContent=unsynced ? ticketSyncBadgeLabel(value) : '';
  }
  const syncAll = document.getElementById('sync-all-btn');
  if(syncAll){ syncAll.disabled = busy; syncAll.setAttribute('aria-busy', String(busy)); }
  document.querySelectorAll('#sync-tray [data-sync-tray-action]').forEach(function(button){ button.disabled=busy; });
}
function startOperation(requestId, label){
  if(activeRefreshRequests.has(requestId)){ updateRefreshButtonState(); return; }
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
  const retryItems=items.filter(function(item){ return item.canRetrySync; });
  if(retryItems.length) return {kind:'retry',key:retryItems.length === 1 ? retryItems[0].key : undefined,count:count};
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
  } else if(model.kind === 'retry'){
    addButton(STRINGS.retrySync,true,function(){ if(model.key) req('unsynced.syncOne',{key:model.key}); else activateTab('unsynced'); },true);
    addButton(STRINGS.syncTrayOpenUnsynced,false,function(){ activateTab('unsynced'); });
  } else if(model.kind === 'recovery' || model.kind === 'failedQueued'){
    addButton(STRINGS.syncTrayOpenUnsynced,true,function(){ activateTab('unsynced'); });
  } else if(model.kind === 'failedTicket'){
    addButton(STRINGS.syncTrayOpenEditor,true,function(){ activateTab('tickets'); req('ticket.openEditor',{ticketId:model.ticketId}); });
  } else if(model.kind === 'pending'){
    addButton(STRINGS.syncAllBtn,true,function(){ req('unsynced.syncAll'); },true);
  }
}
function endOperation(requestId){ ticketSyncRequests.delete(requestId); activeSyncRequests.delete(requestId); activeRefreshRequests.delete(requestId); updateSyncButtonStates(); updateRefreshButtonState(); }
function finishOperation(level, requestId, message){
  const handled=unsyncedFeedbackRequests.delete(requestId);
  if(handled) setOperationFeedback(level, message);
  return handled && !document.getElementById('panel-unsynced').hidden;
}
// トレイの折り返しや文字サイズ変更にも追従する。
new ResizeObserver(function(entries){
  document.documentElement.style.setProperty('--sync-tray-height',entries[0].target.getBoundingClientRect().height+'px');
}).observe(document.getElementById('sync-tray'));

`;
