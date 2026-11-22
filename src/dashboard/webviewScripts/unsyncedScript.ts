export const unsyncedScript = String.raw`// ── Unsynced ───────────────────────────────────────────────────────────────
const UNSYNCED_BADGE_META={
  queued:{kind:'queued',label:STRINGS.syncQueued,cls:'sync-queued',icon:'→'},
  recovery_pending:{kind:'review',label:STRINGS.syncRecoveryPending || STRINGS.syncReviewRequired || STRINGS.syncFailed,cls:'sync-review',icon:'△',requiresReview:true},
  commit_unknown:{kind:'review',label:STRINGS.syncOutcomeUnknown || STRINGS.syncReviewRequired || STRINGS.syncFailed,cls:'sync-review',icon:'△',requiresReview:true},
  conflict:{kind:'conflict',label:STRINGS.syncConflict,cls:'sync-conflict',icon:'△'},
  failed:{kind:'failed',label:STRINGS.syncFailed,cls:'sync-failed',icon:'×'},
};
function resolveUnsyncedBadge(item){
  if(item?.inProgress) return {kind:'syncing',label:STRINGS.syncSyncing,cls:'sync-queued',icon:'→'};
  if(item?.lifecycle === 'commit_unknown') return UNSYNCED_BADGE_META.commit_unknown;
  if(item?.requiresReview === true) return UNSYNCED_BADGE_META.recovery_pending;
  const lifecycle=item && typeof item.lifecycle === 'string' ? item.lifecycle : 'queued';
  return UNSYNCED_BADGE_META[lifecycle] || UNSYNCED_BADGE_META.queued;
}
function unsyncedKindLabel(kind){ return kind === 'ticket' ? STRINGS.unsyncedKindTicket : kind === 'newTicket' ? STRINGS.unsyncedKindNewTicket : kind === 'comment' ? STRINGS.unsyncedKindComment : STRINGS.unsyncedKindFile; }
let abandonedVisible=false;
function renderAbandoned(){
  const items=state.unsynced.abandonedItems || [];
  const toggle=document.getElementById('abandoned-toggle');
  const list=document.getElementById('abandoned-list');
  toggle.classList.toggle('hidden',items.length === 0);
  toggle.setAttribute('aria-expanded',String(abandonedVisible));
  toggle.textContent=(abandonedVisible ? STRINGS.hideAbandoned : STRINGS.showAbandoned)+' · '+STRINGS.abandonedCount.replace('{0}',String(items.length));
  toggle.onclick=function(){ abandonedVisible=!abandonedVisible; renderAbandoned(); updateSyncButtonStates(); };
  const removeAll=document.getElementById('forget-all-abandoned-btn');
  removeAll.classList.toggle('hidden',items.length === 0);
  removeAll.onclick=function(){ req('unsynced.forgetAllAbandoned'); };
  list.classList.toggle('hidden',!abandonedVisible || items.length === 0);
  list.innerHTML=abandonedVisible ? items.map(function(item){ const start=item.key.kind === 'ticket' && !(state.unsynced.items || []).some(function(active){ return active.key.kind === 'ticket' && active.key.ticketId === item.key.ticketId; }) ? '<button class="btn btn-secondary" type="button" data-start-ticket="'+esc(item.key.ticketId)+'">'+esc(STRINGS.startNewTicketEdit)+'</button>' : ''; const key=safeJson(item.key); const remove='<button class="btn btn-secondary btn-danger" type="button" data-forget-key="'+key+'">'+esc(STRINGS.deleteRetainedRecord)+'</button>'; return '<div class="unsynced-card" role="listitem"><span class="unsynced-kind-label">'+esc(unsyncedKindLabel(item.key.kind))+'</span><div class="unsynced-body"><div class="unsynced-label">'+esc(item.label)+'</div><div class="unsynced-detail">'+esc(item.detail || '')+'</div><details><summary>'+esc(STRINGS.processingRecord)+'</summary><pre>'+esc(item.processingRecord || '')+'</pre></details>'+start+remove+'</div></div>'; }).join('') : '';
  list.querySelectorAll('[data-start-ticket]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.startNewTicketEdit',{ticketId:Number(button.getAttribute('data-start-ticket'))}); }); });
  list.querySelectorAll('[data-forget-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.forgetAbandoned',{key:JSON.parse(button.getAttribute('data-forget-key'))}); } catch {} }); });
}
function renderUnsynced(){
  if(!state) return; renderAbandoned(); const items=state.unsynced.items || []; const local=state.unsynced.localChanges || []; const count=state.unsynced.totalCount || 0; const tabBadge=document.getElementById('unsynced-badge'); tabBadge.textContent=String(count); tabBadge.setAttribute('aria-label',String(count)); tabBadge.classList.toggle('hidden',count === 0);
  const countLabel=document.getElementById('unsynced-count-label'); countLabel.textContent=(STRINGS.unsyncedCountLabel || STRINGS.tabUnsynced).replace('{0}',String(count)); const syncAll=document.getElementById('sync-all-btn'); const requiresReview=items.some(function(item){ return item.requiresReview || item.lifecycle === 'commit_unknown' || item.lifecycle === 'recovery_pending'; }); syncAll.classList.toggle('hidden',items.length === 0 || requiresReview); syncAll.onclick=function(){ req('unsynced.syncAll'); };
  const queued=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'queued'; }).length; const review=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'review'; }).length; const conflict=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'conflict'; }).length; const failed=items.filter(function(item){ return resolveUnsyncedBadge(item).kind === 'failed'; }).length; const summary=document.getElementById('unsynced-summary'); summary.innerHTML=(review ? '<span class="summary-badge">'+esc(STRINGS.syncReviewRequired || STRINGS.syncFailed)+' <strong>'+review+'</strong></span>' : '')+(queued ? '<span class="summary-badge">'+esc(STRINGS.syncQueued)+' <strong>'+queued+'</strong></span>' : '')+(conflict ? '<span class="summary-badge">'+esc(STRINGS.syncConflict)+' <strong>'+conflict+'</strong></span>' : '')+(failed ? '<span class="summary-badge">'+esc(STRINGS.syncFailed)+' <strong>'+failed+'</strong></span>' : '');
  const list=document.getElementById('unsynced-list');
  const ordered=items.slice().sort(function(a,b){ return Number(resolveUnsyncedBadge(b).kind === 'review')-Number(resolveUnsyncedBadge(a).kind === 'review'); });
  list.innerHTML=ordered.map(function(item,index){
    const status=resolveUnsyncedBadge(item);
    const detail=item.detail || '';
    const group=index === 0 || resolveUnsyncedBadge(ordered[index-1]).kind === 'review' && status.kind !== 'review' ? '<h3 class="unsynced-group-title">'+esc(status.kind === 'review' ? STRINGS.syncReviewRequired : STRINGS.tabUnsynced)+'</h3>' : '';
    const open=item.documentUri ? '<button class="btn btn-secondary" type="button" data-unsynced-action="open" data-uri="'+esc(item.documentUri)+'">'+actionIcon('open')+esc(STRINGS.openInEditor)+'</button>' : '';
    const discardsLaterChanges=item.discardMode === 'nextIntent';
    const discardLabel=discardsLaterChanges ? STRINGS.discardLaterChangesAction : STRINGS.discardAction;
    const discardTitle=discardsLaterChanges ? STRINGS.discardLaterChangesTitle : STRINGS.discardTitle;
    const discardDisabled=item.discardMode === 'none' || item.canDiscard === false;
    const discard='<button class="btn btn-secondary btn-danger" type="button" data-unsynced-action="discard" '+(discardDisabled ? 'disabled aria-describedby="discard-reason-'+index+'"' : 'data-discard-key="'+safeJson(item.key)+'" title="'+esc(discardTitle)+'"')+'>'+esc(discardLabel)+'</button>';
    const actionLabel=item.canRetrySync ? STRINGS.retrySync : status.requiresReview ? STRINGS.resolveRecovery : STRINGS.syncToRedmine;
    const sync='<button class="btn btn-primary" type="button" data-unsynced-action="sync" '+(item.canSync === false ? 'disabled aria-describedby="sync-reason-'+index+'"' : 'data-sync-key="'+safeJson(item.key)+'"')+(status.requiresReview ? ' title="'+esc(STRINGS.resolveRecoveryTooltip)+'"' : '')+'>'+actionIcon('sync')+esc(actionLabel)+'</button>';
    const more='<details class="unsynced-more"><summary class="btn btn-secondary" data-unsynced-action="more">'+esc(STRINGS.moreActions)+'</summary><div class="unsynced-more-actions">'+discard+(discardDisabled ? '<p class="unsynced-action-reason" id="discard-reason-'+index+'">'+esc(STRINGS.discardUnavailableReason)+'</p>' : '')+'<button class="btn btn-secondary btn-danger" type="button" data-unsynced-action="abandon" data-abandon-key="'+safeJson(item.key)+'">'+esc(STRINGS.abandonAction)+'</button></div></details>';
    return group+'<div class="unsynced-card" role="listitem" tabindex="-1" data-sync-in-progress="'+String(!!item.inProgress)+'" data-pending-focus="'+esc((item.pendingFocusIds || []).join(' '))+'" data-queue-key="'+safeJson(item.key)+'"><span class="unsynced-kind-label">'+esc(unsyncedKindLabel(item.key.kind))+'</span><div class="unsynced-body"><div class="unsynced-label">'+esc(item.label)+'</div>'+(detail ? '<div class="unsynced-detail">'+esc(detail)+'</div>' : '')+'</div><div class="unsynced-state">'+badge(status.label,status.cls,status.icon)+'</div><div class="unsynced-actions">'+sync+open+more+'</div>'+(item.canSync === false ? '<p class="unsynced-action-reason" id="sync-reason-'+index+'">'+esc(STRINGS.syncUnavailableReason)+'</p>' : '')+'</div>';
  }).join('') + renderLocalPendingChanges(local);
  list.querySelectorAll('[data-abandon-key]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.abandonOne',{key:JSON.parse(button.getAttribute('data-abandon-key'))}); }); });
  list.querySelectorAll('.unsynced-more').forEach(function(menu){ menu.addEventListener('keydown',function(event){ if(event.key === 'Escape'){ menu.open=false; menu.querySelector('summary').focus(); event.preventDefault(); } }); });
  list.querySelectorAll('[data-uri]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.openLocalFile',{documentUri:button.dataset.uri}); }); });
  list.querySelectorAll('[data-discard-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.discardOne',{key:JSON.parse(button.getAttribute('data-discard-key'))}); } catch {} }); });
  list.querySelectorAll('[data-sync-key]').forEach(function(button){ button.addEventListener('click',function(){ try { req('unsynced.syncOne',{key:JSON.parse(button.getAttribute('data-sync-key'))}); } catch {} }); });
  list.querySelectorAll('[data-pending-id]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.openPendingChange',{itemId:button.dataset.pendingId}); }); });
  list.querySelectorAll('[data-discard-pending-id]').forEach(function(button){ button.addEventListener('click',function(){ req('unsynced.discardPendingChange',{itemId:button.dataset.discardPendingId}); }); });
  updateSyncButtonStates();
}

function renderLocalPendingChanges(items){
  if(!items.length) return '';
  return '<h3 class="unsynced-group-title">'+esc(STRINGS.localPendingChanges)+'</h3>'+items.map(function(item){
    const open=item.open ? '<button class="btn btn-secondary" type="button" data-unsynced-action="open" data-pending-id="'+esc(item.id)+'">'+actionIcon('open')+esc(item.open === 'editor' ? STRINGS.openInEditor : STRINGS.openPendingPreview)+'</button>' : '';
    const discard=item.open === 'preview' && item.canDiscard === true ? '<button class="btn btn-secondary btn-danger" type="button" data-unsynced-action="discard-pending" data-discard-pending-id="'+esc(item.id)+'">'+esc(STRINGS.discardPendingDraft)+'</button>' : '';
    const reason=item.reason ? '<div class="unsynced-detail">'+esc(item.reason)+'</div>' : '';
    return '<div class="unsynced-card unsynced-card-local" role="listitem" tabindex="-1" data-pending-focus="'+esc(item.focusIds.join(' '))+'"><div class="unsynced-body"><div class="unsynced-label">'+esc(item.label)+'</div><div class="unsynced-detail">'+esc(item.detail)+'</div>'+reason+'</div><div class="unsynced-actions">'+open+discard+'</div></div>';
  }).join('');
}

function revealUnsyncedItems(focusIds){
  closeProjectPicker(false); closeLayoutPopover(); closeTicketActionMenus();
  if(!filterDialog.classList.contains('hidden')) closeFilterDialog();
  activateTab('unsynced');
  const cards=Array.from(document.querySelectorAll('#unsynced-list .unsynced-card'));
  const match=cards.find(function(card){ return card.dataset.pendingFocus.split(' ').some(function(id){ return focusIds.includes(id); }); });
  const target=match || document.getElementById('unsynced-list');
  target.focus();
  if(match) match.scrollIntoView({block:'nearest'});
}

`;
