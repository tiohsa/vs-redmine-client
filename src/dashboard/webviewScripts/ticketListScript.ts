export const ticketListScript = {
  treeNavigation: String.raw`function findTicket(nodes, ticketId){
  for(const node of nodes || []){ if(node.id === ticketId) return node; const nested = findTicket(node.children,ticketId); if(nested) return nested; }
  return null;
}
function flattenVisible(nodes, result){
  const output = result || [];
  for(const node of nodes || []){ output.push(node); if(node.children && node.children.length && expandedTicketIds.has(node.id)) flattenVisible(node.children,output); }
  return output;
}
function syncExpandedState(nodes){
  for(const node of nodes || []){ if(node.children && node.children.length && !collapsedTicketIds.has(node.id)) expandedTicketIds.add(node.id); syncExpandedState(node.children); }
}
function expandAncestorsOfTicket(nodes, targetId, ancestors){
  const path = ancestors || [];
  for(const node of nodes || []){
    if(node.id === targetId){
      path.forEach(function(ancestorId){ expandedTicketIds.add(ancestorId); collapsedTicketIds.delete(ancestorId); });
      return true;
    }
    if(node.children && node.children.length && expandAncestorsOfTicket(node.children, targetId, path.concat([node.id]))) return true;
  }
  return false;
}
`,
  rendering: String.raw`// ── Ticket list ───────────────────────────────────────────────────────────
function closeTicketActionMenus(){
  const activeMenu=activeTicketActionMenuId && document.getElementById(activeTicketActionMenuId);
  if(activeMenu && activeMenu.contains(document.activeElement)) document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]')?.focus();
  document.querySelectorAll('.ticket-action-menu').forEach(function(menu){ menu.classList.add('hidden'); });
  document.querySelectorAll('.ticket-action-btn[aria-expanded="true"]').forEach(function(button){ button.setAttribute('aria-expanded','false'); });
  activeTicketActionMenuId = null;
  activeTicketActionAnchorTop = null;
}
function toggleTicketActionMenu(ticketId){
  const id = 'ticket-action-menu-' + ticketId;
  const open = activeTicketActionMenuId !== id;
  closeTicketActionMenus();
  if(!open) return;
  const menu = document.getElementById(id);
  const button = document.querySelector('[data-ticket-action-menu="'+ticketId+'"]');
  if(menu){ menu.classList.remove('hidden'); menu.querySelector('[role="menuitem"]')?.focus(); }
  if(button) button.setAttribute('aria-expanded','true');
  activeTicketActionMenuId = id;
  if(menu){
    const rect=button.getBoundingClientRect();
    activeTicketActionAnchorTop=rect.top;
    const bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.right-bounds.width,window.innerWidth-bounds.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-bounds.height-8))+'px';
  }
}
function runTicketAction(action,ticketId){
  closeTicketActionMenus();
  if(action === 'open') req('ticket.openEditor',{ticketId:ticketId});
  else if(action === 'comment') req('comment.add',{ticketId:ticketId});
  else if(action === 'browser') req('ticket.openBrowser',{ticketId:ticketId});
  else if(action === 'child') req('ticket.createChild',{parentTicketId:ticketId});
  else if(action === 'sync') req('ticket.syncSelected',{ticketId:ticketId});
  else if(action === 'refresh') req('dashboard.refresh');
}
document.addEventListener('click', function(event){ if(!isElement(event.target) || !event.target.closest('.ticket-action-menu,.ticket-action-btn')) closeTicketActionMenus(); });
document.addEventListener('keydown', function(event){
  if(!activeTicketActionMenuId) return;
  const menu=document.getElementById(activeTicketActionMenuId);
  const trigger=document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]');
  if(event.key === 'Escape'){ closeTicketActionMenus(); trigger?.focus(); event.preventDefault(); return; }
  if(!menu || !menu.contains(event.target)) return;
  const items=Array.from(menu.querySelectorAll('[role="menuitem"]'));
  const current=items.indexOf(document.activeElement);
  let next=-1;
  if(event.key === 'ArrowDown') next=(current+1)%items.length;
  if(event.key === 'ArrowUp') next=(current-1+items.length)%items.length;
  if(event.key === 'Home') next=0;
  if(event.key === 'End') next=items.length-1;
  if(next >= 0){ items[next].focus(); event.preventDefault(); }
});
document.addEventListener('focusin', function(event){
  if(activeTicketActionMenuId && isElement(event.target) && !event.target.closest('.ticket-actions')) closeTicketActionMenus();
});
document.addEventListener('scroll',function(event){
  if(!activeTicketActionMenuId || (isElement(event.target) && event.target.closest('.ticket-action-menu'))) return;
  const trigger=document.querySelector('[aria-controls="'+activeTicketActionMenuId+'"]');
  if(!trigger || trigger.getBoundingClientRect().top !== activeTicketActionAnchorTop) closeTicketActionMenus();
},true);
function trackerAccentClass(name){
  const n = String(name || '').trim().toLowerCase();
  if(!n) return 'tracker-neutral';
  if(n.includes('bug') || n.includes('defect') || n.includes('バグ') || n.includes('不具合') || n.includes('障害')) return 'tracker-bug';
  if(n.includes('feature') || n.includes('enhancement') || n.includes('機能') || n.includes('改善')) return 'tracker-feature';
  if(n.includes('task') || n.includes('todo') || n.includes('chore') || n.includes('タスク') || n.includes('作業')) return 'tracker-task';
  return 'tracker-neutral';
}
function statusPillClass(name){
  const n = String(name || '').trim().toLowerCase();
  if(n === 'new' || n === '新規') return 'status-new';
  if(n === 'in progress' || n === '進行中') return 'status-in-progress';
  if(n === 'resolved' || n === 'closed' || n === '解決' || n === '終了' || n === '完了') return 'status-resolved';
  return '';
}
function priorityIndicator(name){
  const n = String(name || '').trim().toLowerCase();
  if(!n) return '';
  if(n === 'urgent' || n === 'immediate' || n.includes('今すぐ') || n.includes('急いで') || n.includes('緊急')){
    return '<span class="priority-indicator priority-urgent" title="'+esc(STRINGS.sortPriority+': '+name)+'" aria-label="'+esc(STRINGS.sortPriority+': '+name)+'">!!</span>';
  }
  if(n === 'high' || n.includes('高め') || n === '高'){
    return '<span class="priority-indicator priority-high" title="'+esc(STRINGS.sortPriority+': '+name)+'" aria-label="'+esc(STRINGS.sortPriority+': '+name)+'">!</span>';
  }
  return '';
}
function formatShortDueDate(dateStr){
  const match = DATE_ONLY_PATTERN.exec(String(dateStr || ''));
  return match ? match[2]+'/'+match[3] : String(dateStr || '');
}
function renderDraftRow(draft){
  const selected = draft.queueId === selectedDraftId;
  const trackerCls = trackerAccentClass(draft.trackerName);
  const trackerBar = '<span class="ticket-tracker-bar" aria-hidden="true"'+(draft.trackerName ? ' title="'+esc(STRINGS.sortTracker+': '+draft.trackerName)+'"' : '')+'></span>';
  const status = state.settings.showStatus !== false && draft.statusName ? '<span class="ticket-attribute status-pill '+statusPillClass(draft.statusName)+'">'+esc(draft.statusName)+'</span>' : '';
  const syncStateText = draft.syncState && draft.syncState !== 'Draft' ? syncLabel(draft.syncState) : STRINGS.unsyncedShort;
  const unsyncedInline = '<span class="unsynced-inline-badge" title="'+esc(syncLabel(draft.syncState || 'Draft'))+'"><span class="unsynced-dot" aria-hidden="true"></span>'+esc(syncStateText)+'</span>';
  const assignee = hasAssignee(draft.assigneeName) ? '<span class="ticket-meta-item ticket-meta-assignee" title="'+esc(draft.assigneeName)+'">'+actionIcon('account')+'<span>'+esc(draft.assigneeName)+'</span></span>' : '';
  const dueDiff = draft.dueDate ? daysUntilDateOnly(draft.dueDate, new Date()) : undefined;
  const isOverdue = dueDiff !== undefined && dueDiff < 0;
  const dueDate = draft.dueDate ? '<span class="ticket-meta-item ticket-meta-due'+(isOverdue ? ' is-overdue' : '')+'" title="'+esc(STRINGS.dueDateLabel+': '+draft.dueDate)+'">'+actionIcon('calendar')+'<span>'+esc(formatShortDueDate(draft.dueDate))+'</span></span>' : '';
  return '<div class="ticket-row '+trackerCls+' is-draft is-unsynced'+(selected ? ' selected' : '')+'" data-draft-queue-id="'+esc(draft.queueId)+'" data-draft-uri="'+esc(draft.documentUri)+'" role="listitem" aria-current="'+selected+'" tabindex="0" data-level="0">'+trackerBar+'<div class="ticket-row-content"><div class="ticket-row-main"><div class="ticket-row-title-group"><span class="ticket-id ticket-id-new">#NEW</span>'+priorityIndicator(draft.priorityName)+'<span class="ticket-subject" title="'+esc(draft.subject)+'">'+esc(draft.subject)+'</span></div></div><div class="ticket-row-meta"><div class="ticket-meta-left">'+status+unsyncedInline+'</div><div class="ticket-meta-right">'+assignee+dueDate+'</div></div></div></div>';
}
function renderTicketRow(ticket){
  const selected=selectedDraftId === null && ticket.id === state.selectedTicketId;
  const searching=!!state.ticketSearch?.query;
  const hasChildren=!searching && !!ticket.children?.length;
  const expanded=!!ticket.autoExpand || expandedTicketIds.has(ticket.id);
  const unsynced=!!ticket.syncState && ticket.syncState !== 'Synced';
  const trackerCls=trackerAccentClass(ticket.trackerName);
  const trackerBar='<span class="ticket-tracker-bar" aria-hidden="true"'+(ticket.trackerName ? ' title="'+esc(STRINGS.sortTracker+': '+ticket.trackerName)+'"' : '')+'></span>';
  const status=state.settings.showStatus !== false && ticket.statusName ? '<span class="ticket-attribute status-pill '+statusPillClass(ticket.statusName)+'">'+esc(ticket.statusName)+'</span>' : '';
  const unsyncedInline=unsynced && ticket.syncState !== 'Draft' ? '<span class="unsynced-inline-badge" title="'+esc(syncLabel(ticket.syncState))+'"><span class="unsynced-dot" aria-hidden="true"></span>'+esc(ticketSyncBadgeLabel(ticket.syncState))+'</span>' : '';
  const project=(!state.selectedProject || state.includeChildProjects) && ticket.projectName ? '<span class="ticket-attribute ticket-project">'+esc(ticket.projectName)+'</span>' : '';
  const assignee=hasAssignee(ticket.assigneeName) ? '<span class="ticket-meta-item ticket-meta-assignee" title="'+esc(ticket.assigneeName)+'">'+actionIcon('account')+'<span>'+esc(ticket.assigneeName)+'</span></span>' : '';
  const dueDiff=ticket.dueDate ? daysUntilDateOnly(ticket.dueDate, new Date()) : undefined;
  const isOverdue=dueDiff !== undefined && dueDiff < 0 && !isTicketClosed(ticket);
  const dueDate=ticket.dueDate ? '<span class="ticket-meta-item ticket-meta-due'+(isOverdue ? ' is-overdue' : '')+'" title="'+esc(STRINGS.dueDateLabel+': '+ticket.dueDate)+'">'+actionIcon('calendar')+'<span>'+esc(formatShortDueDate(ticket.dueDate))+'</span></span>' : '';
  const expand=hasChildren ? '<button class="expand-btn" type="button" data-expand="'+ticket.id+'" aria-expanded="'+expanded+'" aria-label="'+esc(expanded ? STRINGS.collapseTitle : STRINGS.expandTitle)+'">'+actionIcon(expanded ? 'chevronDown' : 'chevronRight')+'</button>' : '';
  const level=searching ? 0 : (ticket.level || 0);
  let guides='';
  for(let i=0;i<level;i++) guides+='<span class="ticket-indent-guide" aria-hidden="true"></span>';
  if(level > 0) guides+='<span class="ticket-indent-branch" aria-hidden="true"></span>';
  return '<div class="ticket-row '+trackerCls+(unsynced ? ' is-unsynced' : '')+(level > 0 ? ' child-row' : '')+(selected ? ' selected' : '')+'" data-id="'+ticket.id+'" role="listitem" aria-current="'+selected+'" tabindex="0" data-level="'+level+'">'+trackerBar+guides+'<div class="ticket-row-content"><div class="ticket-row-main"><div class="ticket-row-title-group">'+expand+'<span class="ticket-id">#'+ticket.id+'</span>'+priorityIndicator(ticket.priorityName)+'<span class="ticket-subject" title="'+esc(ticket.subject)+'">'+esc(ticket.subject)+'</span></div></div><div class="ticket-row-meta"><div class="ticket-meta-left">'+status+unsyncedInline+project+'</div><div class="ticket-meta-right">'+assignee+dueDate+'</div></div></div></div>';
}
function isTicketActionTarget(target){ return isElement(target) && !!target.closest('.ticket-action-btn,.ticket-action-menu,.expand-btn'); }
let renderedTicketMarkup = null;
let ticketAppendStartIds = null;
function renderTickets(){
  if(!state) return;
  renderQuickFilters();
  const list = document.getElementById('ticket-list');
  const focus=captureFocus(list);
  const scroll=document.getElementById('ticket-scroll');
  const previousRows=Array.from(list.querySelectorAll('.ticket-row'));
  const previousTop=scroll.scrollTop;
  const anchor=previousRows.find(function(row){ return row.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top; });
  const anchorOffset=anchor ? anchor.getBoundingClientRect().top-scroll.getBoundingClientRect().top : 0;
  list.setAttribute('aria-busy',String(!!(state.loading.tickets || state.loading.moreTickets)));
  const more = document.getElementById('load-more-row');
  const moreHadFocus=document.activeElement === more;
  const moreError=document.getElementById('load-more-error');
  moreError.textContent=state.errors.moreTickets || '';
  moreError.classList.toggle('hidden',!state.errors.moreTickets);
  more.setAttribute('aria-disabled',String(!!state.loading.moreTickets));
  if(state.loading.tickets){ renderedTicketMarkup=null; ticketAppendStartIds=null; }
  else if(state.loading.moreTickets && !ticketAppendStartIds){ ticketAppendStartIds=new Set(previousRows.map(function(row){ return row.dataset.id; })); }
  const count = document.getElementById('ticket-count');
  count.textContent = '';
  if(state.errors.tickets && !state.loading.tickets){
    renderedTicketMarkup=null;
    list.innerHTML='<div class="state-msg error-msg" role="alert"><strong>'+esc(STRINGS.errorLabel)+'</strong><p>'+esc(state.errors.tickets)+'</p><button id="retry-tickets" class="btn btn-secondary" type="button">'+esc(STRINGS.retry)+'</button></div>';
    list.querySelector('#retry-tickets').addEventListener('click',function(){ submitSearch(); });
    more.classList.add('hidden'); updateSyncButtonStates(); return;
  }
  const allDrafts = state.draftTickets || [];
  if(!state.selectedProject && !state.tickets.length && !allDrafts.length && !state.loading.tickets && !searchQuery){ renderedTicketMarkup=null; list.innerHTML='<div class="state-msg">'+STRINGS.noProjectSelected+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  if(state.loading.tickets){ list.innerHTML='<div class="state-msg loading-state" role="status">'+esc(STRINGS.loadingTickets)+'</div>'; more.classList.add('hidden'); updateSyncButtonStates(); return; }
  const hasActiveQuickFilter=hasEffectiveQuickFilters();
  const drafts = allDrafts.filter(matchesDraftFilters);
  const tickets = state.ticketSearch?.query
    ? flattenAll(state.tickets).filter(matchesQuickFilters)
    : hasActiveQuickFilter
      ? flattenFilteredTree(filterTicketTree(state.tickets))
      : flattenVisible(state.tickets);
  const totalLoaded = (state.loadedTicketCount || 0) + allDrafts.length;
  const totalShown = drafts.length + tickets.length;
  count.textContent = totalShown === totalLoaded ? STRINGS.loadedTickets.replace('{0}',String(totalLoaded)) : STRINGS.shownLoadedTickets.replace('{0}',String(totalShown)).replace('{1}',String(totalLoaded));
  const markup = totalShown ? ((drafts.length ? drafts.map(renderDraftRow).join('') : '') + (tickets.length ? tickets.map(renderTicketRow).join('') : '')) : '<div class="state-msg" role="status"><strong>'+esc(STRINGS.noTicketsFound)+'</strong><p>'+esc(STRINGS.searchEmptyHint)+'</p><button id="clear-filters-btn" class="empty-clear-link" type="button">'+esc(STRINGS.clearFilters || STRINGS.resetFilters)+'</button></div>';
  if(state.hasMoreTickets || state.loading.moreTickets){ more.classList.remove('hidden'); more.textContent=state.loading.moreTickets ? STRINGS.loadingMore : state.errors.moreTickets ? STRINGS.retry : STRINGS.loadMore; } else more.classList.add('hidden');
  // 追加取得の開始・失敗通知だけでは既存行を作り直さない。
  if(markup !== renderedTicketMarkup){
    list.innerHTML=markup; renderedTicketMarkup=markup;
    const clearBtn = typeof list.querySelector === 'function' ? list.querySelector('#clear-filters-btn') : null;
    if(clearBtn){
      clearBtn.addEventListener('click', function(){
        quickFilters.clear();
        persistViewState();
        if(searchInput.value){ clearSearch(); }
        else { renderTickets(); }
      });
    }
    const updateSelectedRowVisual = function(targetRow){
      list.querySelectorAll('.ticket-row').forEach(function(candidate){
        const isCurrent = candidate === targetRow;
        candidate.classList.toggle('selected', isCurrent);
        candidate.setAttribute('aria-current', String(isCurrent));
      });
    };
    list.querySelectorAll('.ticket-row').forEach(function(row){
      const level = Math.max(0,Number(row.dataset.level) || 0);
      row.style.paddingLeft=(12 + level * 14)+'px';
      row.querySelectorAll('.ticket-indent-guide').forEach(function(guide, idx){ guide.style.left=(12 + idx * 14 + 2)+'px'; });
      const branch = row.querySelector('.ticket-indent-branch');
      if(branch && level > 0){ branch.style.left=(12 + (level - 1) * 14 + 2)+'px'; }
      row.addEventListener('click',function(event){
        if(isTicketActionTarget(event.target)) return;
        if(row.dataset.draftQueueId){
          selectedDraftId = row.dataset.draftQueueId;
          updateSelectedRowVisual(row);
          req('ticket.openDraft',{queueId:row.dataset.draftQueueId,documentUri:row.dataset.draftUri});
          return;
        }
        selectedDraftId = null;
        const id=Number(row.dataset.id);
        if(state.selectedTicketId === id){ renderTicketDetail(); }
        req('ticket.select',{ticketId:id});
      });
      row.addEventListener('dblclick',function(event){
        if(isTicketActionTarget(event.target)) return;
        if(row.dataset.draftQueueId){ req('ticket.openDraft',{queueId:row.dataset.draftQueueId,documentUri:row.dataset.draftUri}); return; }
        req('ticket.openEditor',{ticketId:Number(row.dataset.id)});
      });
      row.addEventListener('keydown',function(event){
        if(isTicketActionTarget(event.target)) return;
        if(event.key === 'Enter' || event.key === ' '){ row.click(); event.preventDefault(); return; }
        if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
          const rows = Array.from(list.querySelectorAll('.ticket-row'));
          const idx = rows.indexOf(row);
          if(idx < 0) return;
          const nextIdx = Math.max(0, Math.min(rows.length - 1, idx + (event.key === 'ArrowDown' ? 1 : -1)));
          if(nextIdx !== idx){
            const nextRow = rows[nextIdx];
            updateSelectedRowVisual(nextRow);
            nextRow.focus();
            nextRow.scrollIntoView({ block: 'nearest' });
            if(nextRow.dataset.draftQueueId){
              selectedDraftId = nextRow.dataset.draftQueueId;
              req('ticket.openDraft',{queueId:nextRow.dataset.draftQueueId,documentUri:nextRow.dataset.draftUri,preserveFocus:true});
            } else {
              selectedDraftId = null;
              req('ticket.select',{ticketId:Number(nextRow.dataset.id),preserveFocus:true});
            }
          }
          event.preventDefault();
          return;
        }
        if(event.key === 'ArrowRight' || event.key === 'ArrowLeft'){
          const expandBtn = row.querySelector('.expand-btn');
          if(!expandBtn) return;
          const id = Number(row.dataset.id);
          const isExp = expandBtn.getAttribute('aria-expanded') === 'true';
          if(event.key === 'ArrowRight' && !isExp){ expandedTicketIds.add(id); collapsedTicketIds.delete(id); renderTickets(); event.preventDefault(); }
          else if(event.key === 'ArrowLeft' && isExp){ expandedTicketIds.delete(id); collapsedTicketIds.add(id); renderTickets(); event.preventDefault(); }
        }
      });
    });
    list.querySelectorAll('.expand-btn').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); const id=Number(button.dataset.expand); if(button.getAttribute('aria-expanded') === 'true'){ expandedTicketIds.delete(id); collapsedTicketIds.add(id); } else { expandedTicketIds.add(id); collapsedTicketIds.delete(id); } renderTickets(); }); });
    list.querySelectorAll('[data-ticket-action-menu]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); toggleTicketActionMenu(Number(button.dataset.ticketActionMenu)); }); });
    list.querySelectorAll('[data-ticket-action]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); runTicketAction(button.dataset.ticketAction,Number(button.dataset.ticket)); }); });
    list.querySelectorAll('[data-draft-action="sync"]').forEach(function(button){ button.addEventListener('click',function(event){ event.stopPropagation(); req('ticket.syncDraft',{queueId:button.dataset.draftQueueId,documentUri:button.dataset.draftUri}); }); });
  }
  more.onclick = function(){
    if(more.getAttribute('aria-disabled') === 'true') return;
    more.setAttribute('aria-disabled','true'); req('tickets.loadMore');
  };
  restoreFocus(focus);
  if(moreHadFocus && more.classList.contains('hidden')){
    const priorIds=ticketAppendStartIds || new Set(previousRows.map(function(row){ return row.dataset.id; }));
    const added=Array.from(list.querySelectorAll('.ticket-row')).find(function(row){ return !priorIds.has(row.dataset.id); });
    (added || count).focus({preventScroll:true});
  }
  const restoredAnchor=anchor && anchor.dataset.id && list.querySelector('.ticket-row[data-id="'+CSS.escape(anchor.dataset.id)+'"]');
  if(restoredAnchor) scroll.scrollTop+=restoredAnchor.getBoundingClientRect().top-scroll.getBoundingClientRect().top-anchorOffset;
  else scroll.scrollTop=previousTop;
  if(!state.loading.moreTickets) ticketAppendStartIds=null;
  updateSyncButtonStates();
}

`,
};
