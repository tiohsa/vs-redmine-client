export const tabsScript = String.raw`// ── Tabs ───────────────────────────────────────────────────────────────────
const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"]'));
const panels = Array.from(document.querySelectorAll('#content > [role="tabpanel"]'));
function activateTab(name){
  tabs.forEach(function(tab){
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });
  panels.forEach(function(panel){
    const active = panel.id === 'panel-' + name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  if(name === 'tickets' && pendingScrollSelectedTicketId !== null && pendingScrollSelectedTicketId === state?.selectedTicketId){
    const selectedRow=document.querySelector('#ticket-list .ticket-row[data-id="'+CSS.escape(String(pendingScrollSelectedTicketId))+'"]');
    if(selectedRow && typeof selectedRow.scrollIntoView === 'function') selectedRow.scrollIntoView({ block: 'nearest' });
    pendingScrollSelectedTicketId = null;
  }
  if(name === 'tickets' && pendingScrollSelectedCommentKey !== null && pendingScrollSelectedCommentKey === selectedCommentKey(state?.comments) && !state?.comments?.loading && state?.comments?.ticketId === state?.selectedTicketId){
    const selectedCommentCard=document.querySelector('#comments-list .comment-card.selected');
    if(selectedCommentCard){
      if(typeof selectedCommentCard.scrollIntoView === 'function') selectedCommentCard.scrollIntoView({ block: 'nearest' });
      pendingScrollSelectedCommentKey = null;
    }
  }
}
tabs.forEach(function(tab){ tab.addEventListener('click', function(){ activateTab(tab.dataset.tab); }); });
document.getElementById('tabs').addEventListener('keydown', function(event){
  const current = tabs.findIndex(function(tab){ return tab.getAttribute('aria-selected') === 'true'; });
  let next = -1;
  if(event.key === 'ArrowRight') next = (current + 1) % tabs.length;
  if(event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
  if(event.key === 'Home') next = 0;
  if(event.key === 'End') next = tabs.length - 1;
  if(next >= 0){ activateTab(tabs[next].dataset.tab); tabs[next].focus(); event.preventDefault(); }
});

`;
