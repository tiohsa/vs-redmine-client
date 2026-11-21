import {
  DETAIL_RESIZE_HANDLE_HEIGHT_PX,
  DETAIL_RESIZE_KEYBOARD_STEP_PERCENT,
  MIN_DETAIL_PANEL_HEIGHT_PX,
  MIN_TICKET_LIST_HEIGHT_PX,
} from "../detailPanelResize";

export const detailResizeScript = String.raw`// ── Detail panel resize ──────────────────────────────────────────────────
const MIN_DETAIL_PANEL_HEIGHT_PX = ${MIN_DETAIL_PANEL_HEIGHT_PX};
const MIN_TICKET_LIST_HEIGHT_PX = ${MIN_TICKET_LIST_HEIGHT_PX};
const DETAIL_RESIZE_HANDLE_HEIGHT_PX = ${DETAIL_RESIZE_HANDLE_HEIGHT_PX};
const DETAIL_RESIZE_KEYBOARD_STEP_PERCENT = ${DETAIL_RESIZE_KEYBOARD_STEP_PERCENT};
let detailResizeDrag = null;

function isDetailResizeActive(){
  const panel = document.getElementById('panel-tickets');
  const layout = document.querySelector('.tickets-layout');
  const handle = document.getElementById('detail-resize-handle');
  const card = document.getElementById('ticket-detail-card');
  if(!layout || !handle || !card || (panel && panel.hidden) || card.classList.contains('hidden')) return false;
  if(layout.classList.contains('layout-split') || layout.classList.contains('layout-single') || layout.classList.contains('layout-detail-focus')) return false;
  return window.getComputedStyle(handle).display !== 'none';
}

function clampDetailHeight(requestedPercent, containerHeight, handleHeight){
  const safeHandle = typeof handleHeight === 'number' && Number.isFinite(handleHeight) && handleHeight >= 0 ? handleHeight : DETAIL_RESIZE_HANDLE_HEIGHT_PX;
  const safeRequested = typeof requestedPercent === 'number' && Number.isFinite(requestedPercent) ? requestedPercent : DEFAULT_DETAIL_HEIGHT_PERCENT;
  if(typeof containerHeight !== 'number' || !Number.isFinite(containerHeight) || containerHeight <= 0){
    const fallback = normalizeDetailHeightPercent(safeRequested);
    return { percent: fallback, minPercent: 1, maxPercent: 99 };
  }
  const rawMin = (MIN_DETAIL_PANEL_HEIGHT_PX / containerHeight) * 100;
  const rawMax = ((containerHeight - MIN_TICKET_LIST_HEIGHT_PX - safeHandle) / containerHeight) * 100;
  if(rawMin > rawMax){
    const available = Math.max(0, containerHeight - safeHandle);
    const ratio = MIN_DETAIL_PANEL_HEIGHT_PX / (MIN_DETAIL_PANEL_HEIGHT_PX + MIN_TICKET_LIST_HEIGHT_PX);
    const fallback = Math.round(((available * ratio) / containerHeight) * 10000) / 100;
    return { percent: fallback, minPercent: fallback, maxPercent: fallback };
  }
  const ceiledMin = Math.ceil(rawMin * 100) / 100;
  const flooredMax = Math.floor(rawMax * 100) / 100;
  const minPercent = ceiledMin <= flooredMax ? ceiledMin : rawMin;
  const maxPercent = ceiledMin <= flooredMax ? flooredMax : rawMax;
  const clamped = clamp(safeRequested, minPercent, maxPercent);
  const rounded = Math.round(clamped * 100) / 100;
  const percent = clamp(rounded, minPercent, maxPercent);
  return { percent: percent, minPercent: minPercent, maxPercent: maxPercent };
}

function getDetailResizeMeasurements(){
  const layout = document.querySelector('.tickets-layout');
  const handle = document.getElementById('detail-resize-handle');
  const containerHeight = layout ? layout.getBoundingClientRect().height : 0;
  const measuredHandle = handle ? handle.getBoundingClientRect().height : 0;
  const handleHeight = measuredHandle > 0 ? measuredHandle : DETAIL_RESIZE_HANDLE_HEIGHT_PX;
  return { layout: layout, handle: handle, containerHeight: containerHeight, handleHeight: handleHeight };
}

function updateDetailResizeAria(handle, bounds){
  if(!handle) return;
  const rawMin = Math.ceil(bounds.minPercent);
  const rawMax = Math.floor(bounds.maxPercent);
  const ariaMin = rawMin <= rawMax ? rawMin : Math.round(bounds.minPercent);
  const ariaMax = rawMin <= rawMax ? rawMax : Math.round(bounds.maxPercent);
  const ariaNow = clamp(Math.round(bounds.percent), ariaMin, ariaMax);
  handle.setAttribute('aria-valuemin', String(ariaMin));
  handle.setAttribute('aria-valuemax', String(ariaMax));
  handle.setAttribute('aria-valuenow', String(ariaNow));
}

function applyClampedDetailHeight(requestedPercent, commitPreference){
  const m = getDetailResizeMeasurements();
  if(!m.layout) return null;
  const bounds = clampDetailHeight(requestedPercent, m.containerHeight, m.handleHeight);
  if(commitPreference){
    detailHeightPercent = bounds.percent;
  }
  m.layout.style.setProperty('--detail-panel-height', bounds.percent + '%');
  updateDetailResizeAria(m.handle, bounds);
  return bounds;
}

function updateDetailResizeDrag(clientY){
  if(!detailResizeDrag || typeof clientY !== 'number' || !Number.isFinite(clientY)) return;
  const m = getDetailResizeMeasurements();
  const containerHeight = m.containerHeight > 0 ? m.containerHeight : detailResizeDrag.containerHeight;
  if(containerHeight <= 0) return;
  const deltaY = detailResizeDrag.startY - clientY;
  const nextDetailPx = detailResizeDrag.startDetailPx + deltaY;
  const requestedPercent = (nextDetailPx / containerHeight) * 100;
  applyClampedDetailHeight(requestedPercent, true);
}

function handleDetailResizePointerMove(event){
  if(!detailResizeDrag) return;
  if(detailResizeDrag.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== detailResizeDrag.pointerId) return;
  if(detailResizeDrag.initialButtons !== 0 && event.buttons === 0 && event.pointerType === 'mouse'){
    finishDetailResizeDrag(true);
    return;
  }
  detailResizeDrag.moved = true;
  updateDetailResizeDrag(event.clientY);
}

function handleDetailResizePointerUp(event){
  if(!detailResizeDrag) return;
  if(detailResizeDrag.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== detailResizeDrag.pointerId) return;
  if(typeof event.clientY === 'number' && event.clientY !== detailResizeDrag.startY){
    detailResizeDrag.moved = true;
    updateDetailResizeDrag(event.clientY);
  }
  finishDetailResizeDrag(true);
}

function handleDetailResizePointerCancel(event){
  if(!detailResizeDrag) return;
  if(detailResizeDrag.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== detailResizeDrag.pointerId) return;
  finishDetailResizeDrag(false);
}

function handleDetailResizeWindowBlur(){
  if(!detailResizeDrag) return;
  finishDetailResizeDrag(true);
}

function finishDetailResizeDrag(shouldPersist){
  if(!detailResizeDrag) return;
  const activeDrag = detailResizeDrag;
  detailResizeDrag = null;
  window.removeEventListener('pointermove', handleDetailResizePointerMove);
  window.removeEventListener('pointerup', handleDetailResizePointerUp);
  window.removeEventListener('pointercancel', handleDetailResizePointerCancel);
  window.removeEventListener('blur', handleDetailResizeWindowBlur);
  document.body.classList.remove('is-resizing-detail');
  if(activeDrag.handle){
    activeDrag.handle.classList.remove('is-dragging');
    try {
      if(typeof activeDrag.handle.releasePointerCapture === 'function' && typeof activeDrag.pointerId === 'number'){
        activeDrag.handle.releasePointerCapture(activeDrag.pointerId);
      }
    } catch {}
  }
  if(shouldPersist && activeDrag.moved){
    persistViewState();
  }
}

function syncDetailPanelHeight(){
  if(detailResizeDrag && !isDetailResizeActive()){
    finishDetailResizeDrag(false);
  }
  applyClampedDetailHeight(detailHeightPercent, false);
}

const detailResizeHandle = document.getElementById('detail-resize-handle');
if(detailResizeHandle){
  detailResizeHandle.addEventListener('pointerdown', function(event){
    if(event.button !== 0 || detailResizeDrag || !isDetailResizeActive()) return;
    const m = getDetailResizeMeasurements();
    const detailEl = document.querySelector('.tickets-detail');
    if(!m.layout || !detailEl || m.containerHeight <= 0) return;
    event.preventDefault();
    const startDetailPx = detailEl.getBoundingClientRect().height;
    detailResizeDrag = {
      handle: detailResizeHandle,
      pointerId: event.pointerId,
      initialButtons: typeof event.buttons === 'number' ? event.buttons : 0,
      startY: event.clientY,
      startDetailPx: startDetailPx,
      containerHeight: m.containerHeight,
      moved: false,
    };
    document.body.classList.add('is-resizing-detail');
    detailResizeHandle.classList.add('is-dragging');
    try {
      if(typeof detailResizeHandle.setPointerCapture === 'function' && typeof event.pointerId === 'number'){
        detailResizeHandle.setPointerCapture(event.pointerId);
      }
    } catch {}
    window.addEventListener('pointermove', handleDetailResizePointerMove);
    window.addEventListener('pointerup', handleDetailResizePointerUp);
    window.addEventListener('pointercancel', handleDetailResizePointerCancel);
    window.addEventListener('blur', handleDetailResizeWindowBlur);
  });

  detailResizeHandle.addEventListener('dblclick', function(event){
    if(!isDetailResizeActive()) return;
    event.preventDefault();
    finishDetailResizeDrag(false);
    applyClampedDetailHeight(DEFAULT_DETAIL_HEIGHT_PERCENT, true);
    persistViewState();
  });

  detailResizeHandle.addEventListener('keydown', function(event){
    if(event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !isDetailResizeActive()) return;
    const m = getDetailResizeMeasurements();
    if(m.containerHeight <= 0) return;
    const current = clampDetailHeight(detailHeightPercent, m.containerHeight, m.handleHeight);
    let targetPercent = null;
    if(event.key === 'ArrowUp'){
      targetPercent = current.percent + DETAIL_RESIZE_KEYBOARD_STEP_PERCENT;
    } else if(event.key === 'ArrowDown'){
      targetPercent = current.percent - DETAIL_RESIZE_KEYBOARD_STEP_PERCENT;
    } else if(event.key === 'Home'){
      targetPercent = current.minPercent;
    } else if(event.key === 'End'){
      targetPercent = current.maxPercent;
    } else if(event.key === 'Enter'){
      targetPercent = DEFAULT_DETAIL_HEIGHT_PERCENT;
    }
    if(targetPercent === null) return;
    event.preventDefault();
    applyClampedDetailHeight(targetPercent, true);
    persistViewState();
  });
}

window.addEventListener('resize', syncDetailPanelHeight);
const detailCardForResize = document.getElementById('ticket-detail-card');
if(detailCardForResize && typeof MutationObserver === 'function'){
  new MutationObserver(function(){ syncDetailPanelHeight(); }).observe(detailCardForResize, { attributes: true, attributeFilter: ['class'] });
}
const ticketsLayoutForResize = document.querySelector('.tickets-layout');
if(ticketsLayoutForResize && typeof ResizeObserver === 'function'){
  new ResizeObserver(function(){ syncDetailPanelHeight(); }).observe(ticketsLayoutForResize);
}
syncDetailPanelHeight();
`;
