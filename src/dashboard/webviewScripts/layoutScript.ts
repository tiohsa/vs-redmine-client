export const layoutScript = {
  compactMode: String.raw`// ── Header / search ───────────────────────────────────────────────────────
function applyCompactMode(){
  const listEl = document.getElementById('ticket-list');
  if(listEl) listEl.classList.toggle('is-compact', compactMode);
}
applyCompactMode();
`,
  popover: String.raw`const ticketLayoutSelect = document.getElementById('ticket-layout-mode');
const layoutButton = document.getElementById('layout-btn');
const layoutPopover = document.getElementById('layout-popover');
function closeLayoutPopover(){ layoutPopover.classList.add('hidden'); layoutButton.setAttribute('aria-expanded','false'); }
layoutButton.addEventListener('click',function(){ const opening=layoutPopover.classList.contains('hidden'); if(opening) closeProjectPicker(false); layoutPopover.classList.toggle('hidden',!opening); layoutButton.setAttribute('aria-expanded',String(opening)); if(opening){ const anchor=layoutButton.getBoundingClientRect(); const bounds=layoutPopover.getBoundingClientRect(); layoutPopover.style.left=Math.max(8,Math.min(anchor.right-bounds.width,window.innerWidth-bounds.width-8))+'px'; layoutPopover.style.top=Math.max(8,Math.min(anchor.bottom+4,window.innerHeight-bounds.height-8))+'px'; ticketLayoutSelect.focus(); } });
document.addEventListener('click',function(event){ if(!isElement(event.target) || !event.target.closest('.layout-control,.layout-popover')) closeLayoutPopover(); });
document.addEventListener('scroll',function(event){ if(!layoutPopover.classList.contains('hidden') && event.target !== layoutPopover) closeLayoutPopover(); },true);
`,
  layoutSelection: String.raw`layoutPopover.addEventListener('keydown',function(event){ if(event.key === 'Escape'){ closeLayoutPopover(); layoutButton.focus(); event.preventDefault(); } });
function applyTicketLayoutMode(){
  const layout=document.querySelector('.tickets-layout');
  layout.classList.toggle('layout-single',ticketLayoutMode === 'single');
  layout.classList.toggle('layout-split',ticketLayoutMode === 'split');
  layout.classList.toggle('layout-detail-focus',detailFocus);
  document.getElementById('detail-focus-toggle').checked=detailFocus;
  ticketLayoutSelect.value=ticketLayoutMode;
  if(typeof syncDetailPanelHeight === 'function') syncDetailPanelHeight();
  updateCommentExpandButtons();
}
ticketLayoutSelect.addEventListener('change',function(){
  ticketLayoutMode=this.value;
  vscode.setState(Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode}));
  applyTicketLayoutMode();
  closeLayoutPopover(); layoutButton.focus();
});
document.getElementById('detail-focus-toggle').addEventListener('change',function(){
  detailFocus=this.checked; persistViewState(); applyTicketLayoutMode();
});
applyTicketLayoutMode();
`,
};
