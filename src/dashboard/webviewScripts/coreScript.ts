export const coreScript = {
  initialization: String.raw`
'use strict';
const vscode = acquireVsCodeApi();
const STRINGS = window.STRINGS;
const persistedUiState = vscode.getState() || {};
let ticketLayoutMode = ['auto','single','split'].includes(persistedUiState.ticketLayoutMode) ? persistedUiState.ticketLayoutMode : 'auto';
let detailFocus = persistedUiState.detailFocus === true;
let compactMode = persistedUiState.compactMode === true;
const quickFilters = new Set(Array.isArray(persistedUiState.quickFilters) ? persistedUiState.quickFilters.filter(function(value){ return ['mine','open','overdue','high'].includes(value); }) : ['open']);

// 業務状態は DashboardState、Webview 固有のレイアウト選択はvscode.setStateで保持する。
// 以下はそれ以外の表示用一時状態。
let state = null;
let requestCounter = 0;
let searchQuery = '';
let projectSearchQuery = '';
let searchTimer = null;
let searchComposing = false;
const expandedComments = new Set();
let renderedDetailTicketId = null;
let activeTicketActionMenuId = null;
let activeTicketActionAnchorTop = null;
let composerDraftKey = null;
let composerDraftValues = null;
let renderedSettingsBaseUrl = null;
let settingsRenderGeneration = 0;
let selectedDraftId = null;
let pendingScrollSelectedTicketId = null;
let pendingScrollSelectedCommentKey = null;
const ticketSyncRequests = new Map();
const expandedTicketIds = new Set();
const collapsedTicketIds = new Set();
const activeSyncRequests = new Set();
const activeRefreshRequests = new Set();
const unsyncedFeedbackRequests = new Set();

function esc(value){ return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function send(message){ vscode.postMessage(message); }
function req(type, extra){
  if(type === 'dashboard.refresh'){
    if(activeRefreshRequests.size) return;
    const requestId='req-'+(++requestCounter);
    activeRefreshRequests.add(requestId);
    updateRefreshButtonState();
    send(Object.assign({type:type,requestId:requestId}, extra || {}));
    return requestId;
  }
  const queueAction = ['unsynced.syncOne','unsynced.syncAll','unsynced.discardOne','unsynced.abandonOne','unsynced.forgetAbandoned','unsynced.forgetAllAbandoned','unsynced.startNewTicketEdit'].includes(type);
  const ticketAction = type === 'ticket.syncSelected' || type === 'ticket.reviewConflict';
  const draftSyncAction = type === 'ticket.syncDraft';
  const commentSyncAction = type === 'comment.syncSelected';
  if((queueAction || ticketAction || draftSyncAction || commentSyncAction) && activeSyncRequests.size) return;
  if(ticketAction && state?.selectedTicket?.syncState === 'Syncing') return;
  const requestId='req-'+(++requestCounter);
  if(queueAction) unsyncedFeedbackRequests.add(requestId);
  if(ticketAction) ticketSyncRequests.set(requestId,extra.ticketId);
  if(queueAction || ticketAction || draftSyncAction || commentSyncAction){ activeSyncRequests.add(requestId); updateSyncButtonStates(); }
  send(Object.assign({type:type,requestId:requestId}, extra || {}));
  return requestId;
}
function isElement(value){ return !!value && typeof value.closest === 'function'; }
function clamp(value, min, max){ return Math.min(Math.max(value, min), max); }
function safeJson(value){ try { return esc(JSON.stringify(value)); } catch { return ''; } }

// DOM 更新後も同じコントロールへ戻す。入力値や選択位置はフォーム側で保持する。
function captureFocus(root){
  const element=document.activeElement;
  if(!element || !root.contains(element)) return null;
  const card=element.closest('#unsynced-list .unsynced-card');
  if(card){
    return {queueKey:card.dataset.queueKey,queueIndex:Array.from(card.parentNode.querySelectorAll('.unsynced-card')).indexOf(card),action:element.dataset.unsyncedAction,moreOpen:!!card.querySelector('.unsynced-more[open]')};
  }
  let selector=element.id ? '#'+CSS.escape(element.id) : null;
  if(!selector){
    const attributes=['data-ticket-action-menu','data-ticket-action','data-comment-action','data-draft-action','data-draft-queue-id','data-expand','data-expand-comment','data-metadata-field','data-id','data-comment-id','data-comment-uri'];
    const attribute=attributes.find(function(name){ return element.hasAttribute(name); });
    if(attribute) selector='['+attribute+'="'+CSS.escape(element.getAttribute(attribute))+'"]';
    const row=element.closest('.ticket-row');
    if(row && row.dataset.draftQueueId && attribute !== 'data-draft-queue-id') selector='.ticket-row[data-draft-queue-id="'+CSS.escape(row.dataset.draftQueueId)+'"] '+selector;
    else if(row && row.dataset.id && attribute !== 'data-id') selector='.ticket-row[data-id="'+row.dataset.id+'"] '+selector;
    const commentCard=element.closest('.comment-card');
    if(commentCard && commentCard.dataset.commentId && attribute !== 'data-comment-id') selector='.comment-card[data-comment-id="'+CSS.escape(commentCard.dataset.commentId)+'"] '+selector;
    else if(commentCard && commentCard.dataset.commentUri && attribute !== 'data-comment-uri') selector='.comment-card[data-comment-uri="'+CSS.escape(commentCard.dataset.commentUri)+'"] '+selector;
  }
  return selector ? {selector:selector,start:element.selectionStart,end:element.selectionEnd} : null;
}
function restoreFocus(focus){
  if(!focus) return;
  if(focus.queueKey){
    if(document.getElementById('panel-unsynced').hidden) return;
    const cards=Array.from(document.querySelectorAll('#unsynced-list .unsynced-card'));
    const same=cards.find(function(card){ return card.dataset.queueKey === focus.queueKey; });
    const card=same || cards[Math.min(focus.queueIndex,cards.length-1)];
    if(!card){ const feedback=document.getElementById('unsynced-feedback'); (feedback.classList.contains('hidden') ? document.getElementById('unsynced-list') : feedback).focus({preventScroll:true}); return; }
    if(same && focus.moreOpen) card.querySelector('.unsynced-more').open=true;
    const action=same && focus.action ? card.querySelector('[data-unsynced-action="'+CSS.escape(focus.action)+'"]') : null;
    const target=action && !action.disabled ? action : card;
    target.focus({preventScroll:true});
    return;
  }
  const element=document.querySelector(focus.selector);
  if(!element || element.disabled || element.closest('[hidden],.hidden')) return;
  element.focus({preventScroll:true});
  if(typeof focus.start === 'number' && typeof element.setSelectionRange === 'function') element.setSelectionRange(focus.start,focus.end);
}
function flattenAll(nodes){
  return (nodes || []).flatMap(function(node){ return [node].concat(flattenAll(node.children)); });
}

`,
  persistViewState: String.raw`function persistViewState(){
  const nextState=Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode,detailFocus:detailFocus,compactMode:compactMode,quickFilters:Array.from(quickFilters)});
  delete nextState.detailTab;
  vscode.setState(nextState);
}
`,
};
