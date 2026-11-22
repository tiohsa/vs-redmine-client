export const ticketFiltersScript = {
  controls: String.raw`document.querySelectorAll('[data-quick-filter]').forEach(function(button){ button.addEventListener('click',function(){
  const name=button.dataset.quickFilter;
  if(quickFilters.has(name)) quickFilters.delete(name); else quickFilters.add(name);
  persistViewState(); renderTickets();
}); });
const filterDialog=document.getElementById('advanced-filter-dialog');
const filterTrigger=document.getElementById('advanced-filters-btn');
function closeFilterDialog(){ filterDialog.classList.add('hidden'); filterTrigger.focus(); }
function openFilterDialog(){
  if(!state) return;
  const filters=state.settings.filters;
  const options=state.metadataOptions;
  const choices=function(items,selected){ return (items || []).map(function(item){ return '<option value="'+item.id+'"'+((selected || []).includes(item.id)?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); };
  document.getElementById('filter-dialog-fields').innerHTML=
    '<label>'+esc(STRINGS.sortStatus)+'<select id="advanced-status" multiple size="4">'+choices(state.ticketFilterOptions.statuses,filters.statusIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortPriority)+'<select id="advanced-priority" multiple size="4">'+choices(options.priorities,filters.priorityIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortTracker)+'<select id="advanced-tracker" multiple size="4">'+choices(options.trackers,filters.trackerIds)+'</select></label>'+
    '<label>'+esc(STRINGS.sortAssignee)+'<select id="advanced-assignee" multiple size="4">'+choices(state.ticketFilterOptions.assignees,filters.assigneeIds)+'</select></label>'+
    '<label>'+esc(STRINGS.filterSyncStateLabel)+'<select id="advanced-sync-filter">'
      +'<option value="all"'+((filters.syncFilter || 'all') === 'all' ? ' selected' : '')+'>'+esc(STRINGS.filterSyncAll)+'</option>'
      +'<option value="editing"'+(filters.syncFilter === 'editing' ? ' selected' : '')+'>'+esc(STRINGS.filterSyncEditing)+'</option>'
      +'<option value="dirty"'+(filters.syncFilter === 'dirty' ? ' selected' : '')+'>'+esc(STRINGS.filterSyncDirtyOnly)+'</option>'
      +'<option value="unsynced"'+(filters.syncFilter === 'unsynced' ? ' selected' : '')+'>'+esc(STRINGS.filterSyncUnsynced)+'</option>'
    +'</select></label>'+
    '<label class="filter-check"><input id="advanced-unassigned" type="checkbox"'+(filters.includeUnassigned?' checked':'')+'>'+esc(STRINGS.filterIncludeUnassignedLabel)+'</label>';
  filterDialog.classList.remove('hidden'); document.getElementById('advanced-status').focus();
}
filterTrigger.addEventListener('click',openFilterDialog);
document.getElementById('filter-dialog-close').addEventListener('click',closeFilterDialog);
filterDialog.addEventListener('click',function(event){ if(event.target === filterDialog) closeFilterDialog(); });
filterDialog.addEventListener('keydown',function(event){
  if(event.key === 'Escape'){ closeFilterDialog(); event.preventDefault(); return; }
  if(event.key !== 'Tab') return;
  const focusable=Array.from(filterDialog.querySelectorAll('button,input,select')).filter(function(item){ return !item.disabled; });
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey && document.activeElement === first){ last.focus(); event.preventDefault(); }
  else if(!event.shiftKey && document.activeElement === last){ first.focus(); event.preventDefault(); }
});
function selectedIds(id){ return Array.from(document.getElementById(id).selectedOptions).map(function(option){ return Number(option.value); }); }
document.getElementById('filter-dialog-apply').addEventListener('click',function(){
  req('settings.update',{patch:{filters:{subjectQuery:'', statusIds:selectedIds('advanced-status'),priorityIds:selectedIds('advanced-priority'),trackerIds:selectedIds('advanced-tracker'),assigneeIds:selectedIds('advanced-assignee'),includeUnassigned:document.getElementById('advanced-unassigned').checked,syncFilter:document.getElementById('advanced-sync-filter').value}}}); closeFilterDialog();
});
document.getElementById('filter-dialog-reset').addEventListener('click',function(){
  req('settings.update',{patch:{filters:{subjectQuery:'',statusIds:[],priorityIds:[],trackerIds:[],assigneeIds:[],includeUnassigned:true,syncFilter:'all'}}}); closeFilterDialog();
});

`,
  filterMatching: String.raw`function quickFilterCapability(name){
  if(name === 'mine') return state?.quickFilterCapabilities?.mine || 'loading';
  if(name === 'open') return state?.quickFilterCapabilities?.open || 'loading';
  return 'available';
}
function isHighPriority(priorityName){
  const n=String(priorityName || '').trim().toLowerCase();
  return n === 'high' || n === 'urgent' || n === 'immediate' || n.includes('高め') || n.includes('急いで') || n.includes('今すぐ') || n.includes('緊急') || n.includes('高');
}
function activeSyncFilter(){
  return state?.settings?.filters?.syncFilter || 'all';
}
function matchesSyncFilter(syncState, isDraft){
  const syncFilter = activeSyncFilter();
  if(syncFilter === 'dirty') return !isDraft && syncState === 'Dirty';
  if(syncFilter === 'editing') return isDraft ? (syncState === 'Draft' || syncState === 'Dirty') : syncState === 'Dirty';
  if(syncFilter === 'unsynced') return syncState !== 'Synced';
  return true;
}
function hasEffectiveQuickFilters(){
  return quickFilters.has('overdue') || quickFilters.has('high') || quickFilters.has('editing') ||
    activeSyncFilter() !== 'all' ||
    (quickFilters.has('mine') && quickFilterCapability('mine') === 'available') ||
    (quickFilters.has('open') && quickFilterCapability('open') === 'available');
}
function isTicketClosed(ticket){
  const statuses = state?.metadataOptions?.statuses || [];
  const status = statuses.find(function(item){ return ticket.statusId !== undefined ? item.id === ticket.statusId : item.name === ticket.statusName; }) ||
    statuses.find(function(item){ return item.name === ticket.statusName; });
  if(status && typeof status.isClosed === 'boolean') return status.isClosed;
  const name = String(ticket.statusName || '').trim().toLowerCase();
  return name === 'closed' || name === 'rejected' || name === '終了' || name === '完了' || name === '却下';
}
function matchesQuickFilters(ticket){
  if(quickFilters.has('mine') && quickFilterCapability('mine') === 'available' && ticket.assigneeId !== state.currentUserId) return false;
  if(quickFilters.has('open') && quickFilterCapability('open') === 'available'){
    const status=(state.metadataOptions?.statuses || []).find(function(item){ return item.id === ticket.statusId; });
    if(!status || status.isClosed !== false) return false;
  }
  if(quickFilters.has('overdue') && (isTicketClosed(ticket) || !(daysUntilDateOnly(ticket.dueDate,new Date()) < 0))) return false;
  if(quickFilters.has('high') && !isHighPriority(ticket.priorityName)) return false;
  if(quickFilters.has('editing') && ticket.syncState !== 'Dirty') return false;
  if(!matchesSyncFilter(ticket.syncState, false)) return false;
  return true;
}
function filterTicketTree(nodes){
  const result = [];
  for(const node of nodes || []){
    const filteredChildren = filterTicketTree(node.children);
    const selfMatch = matchesQuickFilters(node);
    if(selfMatch || filteredChildren.length){
      result.push(Object.assign({}, node, { children: filteredChildren, autoExpand: filteredChildren.length > 0 }));
    }
  }
  return result;
}
function flattenFilteredTree(nodes, result){
  const output = result || [];
  for(const node of nodes || []){
    output.push(node);
    if(node.children && node.children.length && (node.autoExpand || expandedTicketIds.has(node.id))){
      flattenFilteredTree(node.children, output);
    }
  }
  return output;
}
function matchesDraftFilters(draft){
  if(quickFilters.has('mine') && quickFilterCapability('mine') === 'available') return false;
  if(quickFilters.has('overdue') && !(daysUntilDateOnly(draft.dueDate,new Date()) < 0)) return false;
  if(quickFilters.has('high') && !isHighPriority(draft.priorityName)) return false;
  if(quickFilters.has('editing') && draft.syncState !== 'Draft' && draft.syncState !== 'Dirty') return false;
  if(!matchesSyncFilter(draft.syncState, true)) return false;
  const query = String(state?.ticketSearch?.query || searchQuery || '').trim().toLowerCase();
  if(query){
    const haystack = ['#new', 'new', draft.subject, draft.trackerName, draft.statusName, draft.priorityName, draft.assigneeName, draft.detail]
      .filter(Boolean).join(' ').toLowerCase();
    if(!haystack.includes(query)) return false;
  }
  return true;
}
function renderQuickFilters(){
  document.querySelectorAll('[data-quick-filter]').forEach(function(button){
    const name=button.dataset.quickFilter;
    const capability=quickFilterCapability(name);
    const preferred=quickFilters.has(name);
    const disabled=capability !== 'available';
    const unavailableReason=name === 'mine' ? STRINGS.quickMyIssuesUnavailable : STRINGS.quickOpenUnavailable;
    const preferenceReason=name === 'mine' ? STRINGS.quickMyIssuesUnavailableSelected : STRINGS.quickOpenUnavailableSelected;
    const description=capability === 'loading'
      ? STRINGS.quickFilterCapabilityLoading
      : capability === 'unavailable'
        ? (preferred ? preferenceReason : unavailableReason)
        : '';
    button.disabled=disabled;
    button.title=description;
    button.setAttribute('data-capability',capability);
    button.setAttribute('data-preferred',String(preferred));
    button.setAttribute('aria-pressed',String(preferred && !disabled));
    if(description) button.setAttribute('aria-label',(button.textContent || name)+'. '+description);
    else button.removeAttribute('aria-label');
  });
}

`,
  filterChips: String.raw`// ── Filter chips ───────────────────────────────────────────────────────────
function renderFilterChips(){
  if(!state) return;
  const filters=state.settings.filters;
  const count=(filters.assigneeIds || []).length+(filters.statusIds || []).length+(filters.priorityIds || []).length+(filters.trackerIds || []).length+Number(filters.includeUnassigned === false)+Number(Boolean(filters.syncFilter && filters.syncFilter !== 'all'));
  const badge=document.getElementById('advanced-filter-count'); badge.textContent=String(count); badge.classList.toggle('hidden',count === 0);
  filterTrigger.setAttribute('aria-label',STRINGS.advancedFilters+(count ? ' '+count : ''));
  const element=document.getElementById('filter-chips');
  if(element) element.textContent='';
}

`,
};
