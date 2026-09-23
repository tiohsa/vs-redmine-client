/* 実 Chrome で Dashboard の DOM・キーボード操作・画面幅を検証する。
 * pnpm run compile-tests && node scripts/check-dashboard-ui.cjs
 * CHROME_BIN で実行ファイル、DASHBOARD_UI_NO_SANDBOX=1 で CI の sandbox 制約に対応。
 * Redmine への接続は行わず、Webview と同じ HTML/CSP に状態を注入する。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Module = require('node:module');

const originalLoad = Module._load;
const translations = require('../l10n/bundle.l10n.ja.json');
Module._load = function (name, ...args) {
  if (name === 'vscode') return { env: { language: 'ja' }, l10n: { t: key => translations[key] || key } };
  return originalLoad.call(this, name, ...args);
};
const { buildDashboardHtml } = require('../out/dashboard/dashboardHtml');
const { buildDashboardStrings } = require('../out/dashboard/dashboardI18n');
const { DashboardStateStore } = require('../out/dashboard/DashboardStateStore');
const strings = buildDashboardStrings();
Module._load = originalLoad;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-ui-'));
const fixture = path.join(directory, 'dashboard.html');
const bootstrap = `<style nonce="ui-check">:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-button-background:#1456f0;--vscode-button-foreground:#fff;--vscode-focusBorder:#1456f0;--vscode-sideBar-background:#f0f0f0;--vscode-editor-background:#fff;--vscode-foreground:#222;--vscode-descriptionForeground:#45515e;--vscode-panel-border:#e5e7eb;--vscode-errorForeground:#b3261e;--vscode-editorWarning-foreground:#795e00;--vscode-testing-iconPassed:#16825d}:root:has(body.vscode-dark){--vscode-sideBar-background:#252526;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ddd;--vscode-descriptionForeground:#bbb;--vscode-panel-border:#2b2b2b;--vscode-button-background:#007acc;--vscode-focusBorder:#007acc;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-editorWidget-background:#252526}:root:has(body.vscode-high-contrast-light){--vscode-contrastBorder:#000;--vscode-panel-border:#000}:root:has(body.vscode-high-contrast){--vscode-sideBar-background:#000;--vscode-editor-background:#000;--vscode-foreground:#fff;--vscode-descriptionForeground:#fff;--vscode-contrastBorder:#fff;--vscode-focusBorder:#f38518;--vscode-panel-border:#fff}</style><script nonce="ui-check">window.messages=[];let uiState;window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m),getState:()=>uiState,setState:value=>{uiState=value;return value}});const NativeDate=Date;const fixedNow=NativeDate.UTC(2026,8,14,16,0,0);window.Date=class extends NativeDate{constructor(...args){if(args.length===0)super(fixedNow);else super(...args)}static now(){return fixedNow}};</script>`;
fs.writeFileSync(fixture, buildDashboardHtml('ui-check', strings).replace('<head>', '<head>' + bootstrap));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${path.join(directory, 'profile')}`,
  ...(process.env.DASHBOARD_UI_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
let sequence = 0;
const pending = new Map();
const errors = [];
let sessionId;
function call(method, params = {}, target = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function key(key, code = key) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: key === 'Enter' ? 13 : undefined });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}
const state = new DashboardStateStore().getState();
state.selectedProject = { id: 1, name: '検証プロジェクト' };
state.projects = [{ id: 1, name: '検証プロジェクト', level: 0 }];
state.tickets = [{ id: 10, subject: '親チケット：操作性を確認', level: 0, statusName: '進行中', syncState: 'Queued', dueDate: '2020-01-01', children: [{ id: 11, subject: '折りたたみ内の検索対象', level: 1, children: [] }] }];
state.loadedTicketCount = 2;
state.totalTicketCount = 2;
async function push() {
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'dashboard.state',state:${JSON.stringify(state)}}}))`);
}
async function main() {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out: ' + output)), 15000);
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.on('error', reject);
    chrome.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${output}`)); });
  });
  socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
  };
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push({directive:event.effectiveDirective,blockedURI:event.blockedURI}));" });
  await call('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
  await call('Page.bringToFront');
  await call('Page.navigate', { url: 'file://' + fixture });
  await evaluate(`new Promise(resolve=>{if(document.readyState==='complete')resolve();else window.addEventListener('load',resolve,{once:true})})`);
  assert.equal(await evaluate('document.documentElement.lang'), 'ja');
  await push();
  assert.equal(await evaluate(`document.getElementById('search-input').type`), 'text');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#tabs [role="tab"]')).map(tab=>tab.dataset.tab)`), ['tickets','unsynced','settings']);
  assert.equal(await evaluate(`document.getElementById('tab-comments')`), null);
  assert.ok(await evaluate(`document.getElementById('sync-tray') !== null`));
  state.currentUserId = 7;
  state.metadataOptions.statuses = [{ id: 1, name: '進行中', isClosed: false }, { id: 2, name: '完了', isClosed: true }];
  state.tickets[0].assigneeId = 7;
  state.tickets[0].statusId = 1;
  await push();
  await evaluate(`document.querySelector('[data-quick-filter="mine"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="mine"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.shownLoadedTotal.replace('{0}','1').replace('{1}','2').replace('{2}','2'));
  await evaluate(`document.querySelector('[data-quick-filter="open"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  await evaluate(`document.querySelector('[data-quick-filter="overdue"]').click();document.querySelector('[data-quick-filter="unsynced"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  await evaluate(`document.querySelectorAll('[data-quick-filter][aria-pressed="true"]').forEach(button=>button.click())`);
  await evaluate(`document.getElementById('advanced-filters-btn').click()`);
  assert.equal(await evaluate(`document.activeElement.id`), 'advanced-subject');
  await key('Escape');
  assert.equal(await evaluate(`document.activeElement.id`), 'advanced-filters-btn');

  // queued でも Store が remote evidence を検出した項目は破棄不可。
  state.unsynced = { totalCount: 3, items: [
    { key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
    { key: { kind: 'comment', ticketId: 10, commentId: 20 }, label: 'Comment', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
    { key: { kind: 'newTicket', queueId: 'queued-unsafe' }, label: 'New ticket', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
  ] };
  await push();
  assert.ok(await evaluate(`document.getElementById('sync-tray').textContent.includes('3')`));
  assert.equal(await evaluate(`document.querySelectorAll('#sync-tray button').length`), 1);
  await evaluate(`document.getElementById('tab-unsynced').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list .unsynced-actions button:disabled').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-discard-key]').length`), 0);
  const discardCount = await evaluate(`window.messages.filter(m=>m.type==='unsynced.discardOne').length`);
  await evaluate(`document.querySelectorAll('#unsynced-list button:disabled').forEach(button=>button.click())`);
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='unsynced.discardOne').length`), discardCount);
  // nextIntent のみ破棄可能なら同じ queued 表示でも操作が有効になる。
  state.unsynced.items.forEach(item => { item.canDiscard = true; item.discardMode = 'nextIntent'; });
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-discard-key]').length`), 3);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').textContent.trim()`), strings.discardLaterChangesAction);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').getAttribute('title')`), strings.discardLaterChangesTitle);
  await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').click()`);
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'unsynced.discardOne');
  state.unsynced = { totalCount: 1, items: [
    { key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', lifecycle: 'queued', canDiscard: true, discardMode: 'active', canSync: true },
  ] };
  await push();
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').textContent.trim()`), strings.discardAction);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').getAttribute('title')`), strings.discardTitle);
  state.unsynced = { totalCount: 0, items: [] };
  await push();
  assert.ok(await evaluate(`document.getElementById('sync-tray').textContent.includes(${JSON.stringify(strings.syncTrayAllClear)})`));
  await evaluate(`document.getElementById('tab-tickets').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#search-clear-btn').length`), 1);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).paddingLeft`), '12px');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="11"]')).paddingLeft`), '26px');

  // 属性は Redmine の任意の名前を安全に表示し、未設定時は空バッジを作らない。
  state.tickets[0].trackerName = 'Bug <img src=x onerror=alert(1)>';
  state.tickets[0].priorityName = '優先度 "最優先" & 要確認';
  await push();
  assert.equal(await evaluate(`document.querySelector('.ticket-tracker').textContent`), state.tickets[0].trackerName);
  assert.equal(await evaluate(`document.querySelector('.ticket-priority').textContent`), state.tickets[0].priorityName);
  assert.equal(await evaluate(`document.querySelector('.ticket-priority').title`), strings.sortPriority + ': ' + state.tickets[0].priorityName);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-metadata img').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-id="11"] .ticket-metadata').length`), 0);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.ticketCountLabel.replace('{0}', '2'));
  state.tickets[0].trackerName = 'Bug';
  state.tickets[0].priorityName = 'Normal';

  // date-only はローカル暦日で判定し、固定日時で日付境界と不正値を検証する。
  async function assertDueDateBadge(dueDate, className) {
    state.tickets[0].dueDate = dueDate;
    await push();
    const selector = ['due-overdue', 'due-1day', 'due-3days', 'due-7days'].map(name => `.ticket-row[data-id="10"] .${name}`).join(',');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.className || null`), className ? `badge ${className}` : null);
  }
  await assertDueDateBadge('2026-09-14', 'due-overdue');
  await assertDueDateBadge('2026-09-15', 'due-1day');
  await assertDueDateBadge('2026-09-16', 'due-1day');
  await assertDueDateBadge('invalid-date', null);
  await assertDueDateBadge('2026-02-30', null);
  await assertDueDateBadge('2020-01-01', 'due-overdue');

  // 担当者ありは既存アバターを維持し、未設定時は一覧・詳細からアバター自体を除去する。
  state.selectedTicketId = 10;
  state.tickets[0].assigneeName = 'Taro Yamada';
  state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '担当者表示を確認します。' };
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-avatar').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-avatar').textContent`), 'TA');
  assert.equal(await evaluate(`document.querySelectorAll('.detail-avatar').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.detail-avatar').textContent`), 'TA');
  assert.equal(await evaluate(`document.querySelector('.detail-avatar').getAttribute('aria-label')`), 'Taro Yamada');
  await evaluate(`document.getElementById('ticket-detail-toggle').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.detail-avatar').length`), 1);
  // 設定の操作・再描画で一覧の担当者のみを非表示にする。
  await evaluate(`document.getElementById('set-show-assignee').click()`);
  assert.deepEqual(await evaluate(`window.messages.at(-1).patch`), { showAssignee: false });
  state.settings.showAssignee = false;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-avatar').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.detail-avatar').length`), 1);
  assert.equal(await evaluate(`document.getElementById('set-show-assignee').checked`), false);
  state.settings.showAssignee = true;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-avatar').length`), 1);
  assert.equal(await evaluate(`document.getElementById('set-show-assignee').checked`), true);

  // 一覧・詳細・コメント・未同期の同じ操作はラベルと SVG が一致する。
  state.comments.ticketId = 10;
  state.comments.items = [{ id: 20, authorName: 'Taro', body: 'Comment', editableByCurrentUser: true, syncKey: { kind: 'comment', ticketId: 10, commentId: 20 } }];
  state.unsynced = { totalCount: 1, items: [{ key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', documentUri: 'file:///tmp/ticket.md', lifecycle: 'queued' }] };
  await push();
  async function assertSameAction(selectors) {
    const appearances = await evaluate(`(${JSON.stringify(selectors)}).map(selector=>{const button=document.querySelector(selector);return {label:button.textContent.trim(),icon:button.querySelector('svg').outerHTML};})`);
    appearances.slice(1).forEach(actual => assert.deepEqual(actual, appearances[0]));
  }
  await assertSameAction(['[data-ticket-action="open"]', '#detail-open-btn', '[data-edit-comment]', '[data-uri]']);
  await assertSameAction(['[data-ticket-action="comment"]', '#detail-comment-btn', '#add-comment-btn']);
  await assertSameAction(['[data-ticket-action="browser"]', '#detail-browser-btn', '[data-open-comment]']);
  await assertSameAction(['#detail-sync-btn', '[data-sync-key]', '[data-sync-comment-key]']);
  assert.equal(await evaluate(`document.querySelector('#sync-all-btn svg').outerHTML`), await evaluate(`document.querySelector('#detail-sync-btn svg').outerHTML`));
  state.comments.items = [];
  state.unsynced = { totalCount: 0, items: [] };
  await push();
  for (const assigneeName of [undefined, null, '', '   ']) {
    if (assigneeName === undefined) delete state.tickets[0].assigneeName;
    else state.tickets[0].assigneeName = assigneeName;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '未設定の担当者表示を確認します。' };
    await push();
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-avatar').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.detail-avatar').length`), 0);
  }

  // 折りたたみ後の状態更新・子チケット検索・キーボードフォーカス。
  await evaluate(`document.querySelector('[data-expand="10"]').focus()`);
  await key('Enter');
  assert.equal(await evaluate(`document.querySelector('[data-expand="10"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.ticketCountLabel.replace('{0}', '1'));
  assert.equal(await evaluate('window.messages.filter(m=>m.type==="ticket.select").length'), 0);
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-expand="10"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.activeElement.dataset.expand`), '10');
  await evaluate(`document.getElementById('search-input').value='検索対象'; document.getElementById('search-input').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-row').dataset.id`), '11');
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.ticketCountLabel.replace('{0}', '1'));
  await evaluate(`document.getElementById('search-clear-btn').click()`);

  // Enter でメニューを開き、矢印で移動、Escape で起点へ戻る。
  await evaluate(`document.querySelector('[data-ticket-action-menu="10"]').focus()`);
  await key('Enter');
  assert.equal(await evaluate('document.activeElement.dataset.ticketAction'), 'open');
  await key('ArrowDown');
  assert.equal(await evaluate('document.activeElement.dataset.ticketAction'), 'comment');
  await key('Escape');
  assert.equal(await evaluate('document.activeElement.dataset.ticketActionMenu'), '10');
  assert.equal(await evaluate('window.messages.filter(m=>m.type==="ticket.select").length'), 0);

  // Detail の主要操作は既存 request のまま。Markdown preview は安全な読み取り専用。
  state.selectedProject = { id: 1, name: '検証プロジェクト' };
  state.selectedTicketId = 10;
  state.selectedTicket = { id: 10, subject: '詳細操作の検証', projectName: '検証プロジェクト', trackerName: 'Bug', priorityName: 'Normal', statusName: 'Open', assigneeName: 'Taro', startDate: '2026-09-21', dueDate: '2026-09-30', syncState: 'Synced', description: '<img src=x onerror=alert(1)>\nRedmine の説明\n3行目\n4行目' };
  state.editOptions = { ticketId: 10, projectId: 1, loading: false, statusFallback: false, trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Task' }], priorities: [{ id: 1, name: 'Normal' }, { id: 2, name: 'High' }], statuses: [{ id: 1, name: 'Open' }, { id: 2, name: 'Closed' }], assignees: [{ id: 1, name: 'Taro' }] };
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('#ticket-detail-card .detail-tabs [role="tab"]').length`), 2);
  state.tickets[0].syncState = 'Conflict';
  await push();
  assert.ok(await evaluate(`document.getElementById('sync-tray').textContent.includes(${JSON.stringify(strings.syncTrayAttention)})`));
  await evaluate(`document.querySelector('#sync-tray [data-sync-tray-action]').click()`);
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'ticket.syncSelected');
  state.tickets[0].syncState = 'Queued';
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:window.messages.at(-1).requestId,message:'完了'}}))`);
  await push();
  await evaluate(`document.getElementById('detail-tab-overview').focus()`);
  await key('ArrowRight');
  assert.equal(await evaluate(`document.activeElement.id`), 'detail-tab-comments');
  assert.equal(await evaluate(`document.getElementById('detail-comments').hidden`), false);
  await key('Home');
  assert.equal(await evaluate(`document.activeElement.id`), 'detail-tab-overview');
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="10"]').getAttribute('aria-current')`), 'true');
  assert.equal(await evaluate(`document.querySelector('.detail-description').textContent`), state.selectedTicket.description);
  assert.equal(await evaluate(`document.querySelectorAll('#ticket-detail-card textarea, .detail-description img, .detail-description [contenteditable]').length`), 0);
  for (const [id, type] of [['detail-open-btn', 'ticket.openEditor'], ['detail-comment-btn', 'comment.add'], ['detail-browser-btn', 'ticket.openBrowser']]) {
    await evaluate(`document.getElementById('${id}').click()`);
    assert.deepEqual(await evaluate(`({type:window.messages.at(-1).type,ticketId:window.messages.at(-1).ticketId})`), { type, ticketId: 10 });
  }
  assert.equal(await evaluate(`document.querySelectorAll('[data-ticket-action-menu="detail-10"]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-ticket-action="refresh"]').length`), 0);

  // 既存の折りたたみ・展開を保持し、Metadata の一時値をまとめて適用する。
  await evaluate(`if(document.getElementById('ticket-detail-toggle').getAttribute('aria-expanded')==='true') document.getElementById('ticket-detail-toggle').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.detail-expanded').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.detail-description').classList.contains('detail-description-collapsed')`), true);
  await push();
  assert.equal(await evaluate(`document.getElementById('ticket-detail-toggle').getAttribute('aria-expanded')`), 'false');
  await evaluate(`document.getElementById('ticket-detail-toggle').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 0);
  const beforeMetadata = await evaluate('window.messages.length');
  await evaluate(`document.getElementById('metadata-edit-btn').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 6);
  assert.equal(await evaluate(`document.getElementById('metadata-apply-btn').disabled`), true);
  async function stageMetadata(field, value) {
    await evaluate(`(()=>{const input=document.querySelector('[data-metadata-field="${field}"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));})()`);
  }
  await stageMetadata('priority', 'High');
  assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), strings.syncDirty);
  await stageMetadata('due_date', '');
  await evaluate(`document.querySelector('[data-metadata-field="due_date"]').focus()`);
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-metadata-field="priority"]').value`), 'High');
  assert.equal(await evaluate(`document.activeElement.dataset.metadataField`), 'due_date');
  await evaluate(`document.getElementById('metadata-cancel-btn').click()`);
  assert.equal(await evaluate('window.messages.length'), beforeMetadata, 'cancel must not send any request');
  assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), strings.synced);
  assert.equal(await evaluate(`document.activeElement.id`), 'metadata-edit-btn');
  await evaluate(`document.getElementById('metadata-edit-btn').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-metadata-field="priority"]').value`), 'Normal');
  await stageMetadata('tracker', 'Task');
  await stageMetadata('priority', 'High');
  await stageMetadata('status', 'Closed');
  await stageMetadata('assignee', '');
  await stageMetadata('start_date', '2026-09-22');
  await stageMetadata('due_date', '');
  await evaluate(`document.getElementById('metadata-apply-btn').click();document.getElementById('metadata-apply-btn').click()`);
  assert.equal(await evaluate('window.messages.length'), beforeMetadata + 1);
  const metadataRequest = await evaluate('window.messages.at(-1)');
  assert.equal(metadataRequest.type, 'ticket.metadata.update');
  assert.equal(metadataRequest.ticketId, 10);
  assert.deepEqual(metadataRequest.patch, { tracker: 'Task', priority: 'High', status: 'Closed', assignee: '', start_date: '2026-09-22', due_date: '' });
  assert.equal(await evaluate(`document.getElementById('metadata-cancel-btn').disabled`), true);
  assert.equal(await evaluate(`document.getElementById('detail-sync-btn').disabled`), true);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.error',requestId:'${metadataRequest.requestId}',message:'適用に失敗しました'}}))`);
  assert.equal(await evaluate(`document.querySelector('[data-metadata-field="priority"]').value`), 'High');
  assert.equal(await evaluate(`document.getElementById('metadata-apply-btn').disabled`), false);
  await evaluate(`document.getElementById('metadata-apply-btn').click()`);
  const appliedRequest = await evaluate('window.messages.at(-1).requestId');
  state.selectedTicket.priorityName = 'High';
  state.selectedTicket.syncState = 'Dirty';
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'${appliedRequest}',message:'ローカルへ適用しました'}}))`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 0);
  assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), strings.syncDirty);

  // 同期は送信直後から無効化し、state 更新・started・成功・失敗でも二重送信しない。
  const beforeSync = await evaluate('window.messages.length');
  await evaluate(`document.getElementById('detail-sync-btn').click();document.getElementById('detail-sync-btn').click()`);
  assert.equal(await evaluate('window.messages.length'), beforeSync + 1);
  const syncRequest = await evaluate('window.messages.at(-1)');
  assert.equal(syncRequest.type, 'ticket.syncSelected');
  assert.equal(syncRequest.ticketId, 10);
  assert.equal(await evaluate(`document.getElementById('detail-sync-btn').textContent`), strings.syncSyncing);
  await push();
  assert.equal(await evaluate(`document.getElementById('detail-sync-btn').disabled`), true);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.started',requestId:'${syncRequest.requestId}',label:'同期中…'}}))`);
  assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), strings.syncSyncing);
  state.selectedTicket.syncState = 'Synced';
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'${syncRequest.requestId}',message:'同期が完了しました'}}))`);
  assert.equal(await evaluate(`document.getElementById('detail-sync-btn').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('.toast-success:last-child').textContent`), '同期が完了しました');
  await evaluate(`document.getElementById('detail-sync-btn').click()`);
  const failedSync = await evaluate('window.messages.at(-1).requestId');
  state.selectedTicket.syncState = 'Failed';
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.error',requestId:'${failedSync}',message:'同期に失敗しました'}}))`);
  assert.equal(await evaluate(`document.getElementById('detail-sync-btn').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('.toast-error:last-child').textContent`), '同期に失敗しました');
  for (const [syncState, label] of [['Synced', strings.synced], ['Draft', strings.draft], ['Dirty', strings.syncDirty], ['Queued', strings.syncQueued], ['Syncing', strings.syncSyncing], ['Failed', strings.syncFailed], ['Conflict', strings.syncConflict], ['RecoveryPending', strings.syncReviewRequired], ['CommitUnknown', strings.syncReviewRequired]]) {
    state.selectedTicket.syncState = syncState;
    await push();
    assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), label);
    assert.equal(await evaluate(`document.querySelectorAll('.detail-description-warning').length`), syncState === 'Synced' ? 0 : 1);
    assert.equal(await evaluate(`document.getElementById('detail-sync-btn').disabled`), syncState === 'Syncing');
    if (syncState === 'RecoveryPending' || syncState === 'CommitUnknown') {
      await evaluate(`document.getElementById('metadata-edit-btn').click()`);
      await stageMetadata('priority', 'Normal');
      assert.equal(await evaluate(`document.getElementById('detail-sync-state').textContent`), label);
      await evaluate(`document.getElementById('metadata-cancel-btn').click()`);
    }
  }

  // チケット/接続先切替に一時値を持ち越さない。古い応答も新しい編集を閉じない。
  await evaluate(`document.getElementById('metadata-edit-btn').click()`);
  await stageMetadata('priority', 'Normal');
  await evaluate(`document.getElementById('metadata-apply-btn').click()`);
  const staleRequest = await evaluate('window.messages.at(-1).requestId');
  state.selectedTicketId = state.selectedTicket.id = state.editOptions.ticketId = 11;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 0);
  await evaluate(`document.getElementById('metadata-edit-btn').click()`);
  await stageMetadata('priority', 'Normal');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'${staleRequest}',message:'以前の操作'}}))`);
  assert.equal(await evaluate(`document.querySelector('[data-metadata-field="priority"]').value`), 'Normal');
  const originalBaseUrl = state.settings.baseUrl;
  state.settings.baseUrl = 'https://another.example.com';
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 0);
  state.settings.baseUrl = originalBaseUrl;
  state.selectedTicketId = state.selectedTicket.id = state.editOptions.ticketId = 10;
  await push();

  // 手動レイアウトは画面幅より優先され、Webview state に保持される。
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-layout')).flexDirection`), 'column');
  await evaluate(`document.getElementById('ticket-layout-mode').value='split';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-layout')).display`), 'grid');
  const selectedTicketSplit = await evaluate(`(()=>{const master=document.querySelector('.tickets-master').getBoundingClientRect();const detail=document.querySelector('.tickets-detail').getBoundingClientRect();const card=document.getElementById('ticket-detail-card').getBoundingClientRect();return {masterRight:master.right,detailLeft:detail.left,detailRight:detail.right,cardLeft:card.left,cardRight:card.right};})()`);
  assert.equal(selectedTicketSplit.masterRight <= selectedTicketSplit.detailLeft && selectedTicketSplit.cardLeft >= selectedTicketSplit.detailLeft && selectedTicketSplit.cardRight <= selectedTicketSplit.detailRight, true, JSON.stringify(selectedTicketSplit));
  assert.equal(await evaluate(`document.querySelector('.tickets-layout').scrollWidth <= document.querySelector('.tickets-layout').clientWidth`), true);
  assert.equal(await evaluate(`uiState.ticketLayoutMode`), 'split');
  await call('Emulation.setDeviceMetricsOverride', { width: 768, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.getElementById('ticket-layout-mode').value='single';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-layout')).flexDirection`), 'column');
  await evaluate(`document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);

  // 狭幅でも詳細・Metadata 入力がはみ出さず、テーマの境界とフォーカスが残る。
  for (const [theme, width] of [['vscode-light', 280], ['vscode-dark', 320], ['vscode-dark', 440], ['vscode-light', 768], ['vscode-high-contrast', 320]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(theme)}`);
    await push();
    await evaluate(`document.getElementById('metadata-edit-btn').click()`);
    assert.equal(await evaluate(`document.getElementById('ticket-detail-card').scrollWidth <= document.getElementById('ticket-detail-card').clientWidth`), true, `metadata overflow: ${theme} ${width}`);
    assert.equal(await evaluate(`(()=>{const card=document.getElementById('ticket-detail-card').getBoundingClientRect();return [...document.querySelectorAll('.detail-actions button,[data-metadata-field]')].every(el=>{const r=el.getBoundingClientRect();return r.left>=card.left && r.right<=card.right;});})()`), true, `control overflow: ${theme} ${width}`);
    await evaluate(`document.querySelector('.ticket-row[data-id="10"]').focus()`);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).outlineStyle`), 'none');
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]'),'::before').backgroundColor`), 'rgba(0, 0, 0, 0)');
    await evaluate(`document.getElementById('metadata-cancel-btn').click()`);
  }

  // 全タブから新規作成でき、更新中も入力値と選択範囲を保持する。
  await evaluate(`document.getElementById('tab-settings').click(); document.getElementById('new-ticket-btn').click()`);
  assert.equal(await evaluate(`document.getElementById('tab-tickets').getAttribute('aria-selected')`), 'true');
  state.workPanel = { mode: 'newTicket', projectId: 1, projectName: '検証プロジェクト', loading: false, trackers: [{ id: 1, name: 'バグ' }], priorities: [{ id: 1, name: '通常' }], assignees: [], statuses: [], values: { tracker: 'バグ', priority: '通常' } };
  await push();
  assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('ticket-detail-card')).position`), 'fixed');
  assert.equal(await evaluate('document.activeElement.id'), 'work-tracker');
  assert.equal(await evaluate(`document.getElementById('work-sync-new-ticket').disabled`), true);
  assert.equal(await evaluate(`document.getElementById('work-tracker').required`), true);
  await call('Emulation.setDeviceMetricsOverride', { width: 560, height: 700, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.getElementById('ticket-layout-mode').value='split';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('ticket-detail-card').classList.contains('composer-popover')`), false);
  assert.equal(await evaluate(`(()=>{const panel=document.getElementById('ticket-detail-card').getBoundingClientRect();const detail=document.querySelector('.tickets-detail').getBoundingClientRect();return panel.left>=detail.left && panel.right<=detail.right;})()`), true);
  await evaluate(`const input=document.getElementById('work-description'); input.value='入力途中の説明'; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(2,4)`);
  await push();
  assert.deepEqual(await evaluate(`({id:document.activeElement.id,value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})`), { id: 'work-description', value: '入力途中の説明', start: 2, end: 4 });
  for (const width of [440, 320, 280]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const narrowSplitComposer = await evaluate(`(()=>{const card=document.getElementById('ticket-detail-card');const panel=card.getBoundingClientRect();const detail=document.querySelector('.tickets-detail').getBoundingClientRect();const controls=[...card.querySelectorAll('input,select,textarea,button')].map(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right};});return {panelLeft:panel.left,panelRight:panel.right,detailLeft:detail.left,detailRight:detail.right,scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,controlsInside:controls.every(rect=>rect.left>=panel.left&&rect.right<=panel.right)};})()`);
    assert.equal(narrowSplitComposer.panelLeft >= narrowSplitComposer.detailLeft && narrowSplitComposer.panelRight <= narrowSplitComposer.detailRight && narrowSplitComposer.scrollWidth <= narrowSplitComposer.clientWidth && narrowSplitComposer.controlsInside, true, `${width}px: ${JSON.stringify(narrowSplitComposer)}`);
  }
  await evaluate(`document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
  state.workPanel.draftUri = 'file:///tmp/dashboard-smoke-draft.md';
  await push();
  assert.equal(await evaluate(`document.getElementById('work-sync-new-ticket').disabled`), false);
  delete state.workPanel;
  await push();
  assert.equal(await evaluate('document.activeElement.id'), 'new-ticket-btn');

  // プロジェクト未選択でもエラーが案内に隠れず、再試行が既存 protocol を使う。
  state.selectedProject = undefined;
  state.tickets = [];
  state.errors.tickets = '接続に失敗しました';
  await push();
  assert.equal(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('接続に失敗しました')`), true);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), '');
  await evaluate(`document.getElementById('retry-tickets').click()`);
  assert.equal(await evaluate('window.messages.at(-1).type'), 'dashboard.refresh');
  state.errors = {};
  state.loading.tickets = true;
  await push();
  assert.equal(await evaluate(`document.getElementById('ticket-list').getAttribute('aria-busy')`), 'true');
  assert.equal(await evaluate(`document.querySelector('.loading-state').textContent`), strings.loadingTickets);
  state.loading.tickets = false;
  await push();
  assert.equal(await evaluate(`document.getElementById('project-select').value`), '');

  // Settings の主要セクション、編集可能なコントロール、キーボード到達性を検証。
  await evaluate(`document.getElementById('tab-settings').click()`);
  const settingSections = await evaluate(`[...document.querySelectorAll('#settings-content h3')].map(node=>node.textContent)`);
  assert.equal(settingSections.includes(strings.sectionConnection), true);
  assert.equal(settingSections.includes(strings.sectionTickets), true);
  assert.equal(settingSections.includes(strings.sectionSync), true);
  assert.equal(settingSections.includes(strings.sectionEditor), true);
  for (const id of ['set-base-url', 'set-default-project', 'set-request-timeout', 'set-ignore-ssl', 'set-ticket-limit', 'set-editor-storage', 'set-editor-subject']) {
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}) !== null`), true, `missing setting control: ${id}`);
  }
  await evaluate(`document.getElementById('set-base-url').focus(); document.getElementById('set-base-url').value='https://redmine.example.com'; document.getElementById('set-base-url').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate('window.messages.at(-1).type'), 'settings.updateConnection');
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.id'), 'set-default-project');

  // 日本語・テーマ・320/480/768/1200px で設定の横はみ出しを検証。
  for (const width of [320, 480, 768, 1200]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.getElementById('tab-settings').click()`);
    assert.equal(await evaluate(`document.getElementById('settings-panel').scrollWidth <= document.getElementById('settings-panel').clientWidth`), true, `settings overflow at ${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `page overflow at ${width}`);
  }
  state.selectedProject = { id: 1, name: '検証プロジェクト' };
  state.tickets = Array.from({ length: 20 }, (_, index) => ({ id: 10 + index, subject: 'チケットの詳細と操作を確認するための長い件名 ' + index, level: 0, trackerName: '長い名前のカスタムトラッカー', priorityName: 'カスタム優先度・最優先', statusName: '進行中', syncState: 'Queued', dueDate: '2020-01-01', children: [] }));
  state.selectedTicketId = 10;
  state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '日本語の説明文と状態表示を確認します。\nキーボードと画面幅に合わせて操作できます。' };
  for (const [theme, width] of [['vscode-light', 280], ['vscode-light', 320], ['vscode-dark', 440], ['vscode-dark', 768], ['vscode-dark', 1200], ['vscode-high-contrast-light', 480], ['vscode-high-contrast', 320]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(theme)};document.getElementById('tab-tickets').click()`);
    await push();
    if (theme === 'vscode-dark') assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(37, 37, 38)');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.due-overdue')).display !== 'none'`), true);
    assert.equal(await evaluate(`document.querySelector('.tickets-master').scrollWidth <= document.querySelector('.tickets-master').clientWidth`), true);
    assert.equal(await evaluate(`document.getElementById('ticket-scroll').scrollWidth <= document.getElementById('ticket-scroll').clientWidth`), true, `list overflow: ${theme} ${width}`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-master')).borderRightWidth`), '1px');
    assert.equal(await evaluate(`document.querySelector('.ticket-subject').getBoundingClientRect().width >= 40`), true, `subject clipped: ${theme} ${width}`);
    assert.equal(await evaluate(`document.querySelectorAll('.detail-actions svg[aria-hidden="true"]').length`), 4);
    if (width < 700) assert.equal(await evaluate(`document.querySelector('.tickets-master').getBoundingClientRect().height <= innerHeight * .4 + 1`), true);
    await evaluate(`document.querySelector('[data-ticket-action-menu="29"]').scrollIntoView(); document.querySelector('[data-ticket-action-menu="29"]').click()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate(`(()=>{const menu=document.getElementById('ticket-action-menu-29');const r=menu.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&menu.contains(document.elementFromPoint(r.left+10,r.top+10))})()`), true, `menu clipping: ${theme}`);
    await key('Escape');
    await evaluate(`document.getElementById('ticket-scroll').scrollTop=0; document.querySelector('.tickets-layout').scrollTop=0`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(directory, `${theme}-${width}.png`), Buffer.from(data, 'base64'));
  }

  // 操作結果は上で検証済み。プレビューには通常の表示を保存する。
  await evaluate(`document.getElementById('toast-area').replaceChildren()`);
  // 参考図と同じ程度の情報量でサイドバーの成果物を保存する。
  state.tickets = ['検索条件を保存できるようにする', 'チケット一覧の表示を調整', 'コメント編集を確認', '同期結果を確認', '設定画面の文言を改善'].map((subject, index) => ({ id: 2816 - index, subject, level: 0, trackerName: ['Bug', 'Task', 'Feature'][index % 3], priorityName: ['Normal', 'High', 'Low'][index % 3], syncState: 'Synced', children: [] }));
  state.loadedTicketCount = state.totalTicketCount = state.tickets.length;
  state.selectedTicketId = 2816;
  state.selectedTicket = { ...state.tickets[0], projectName: 'eCookbook', statusName: '進行中', assigneeName: '山田 太郎', startDate: '2026-09-21', dueDate: '2026-09-30', syncState: 'Dirty', description: '## 背景\nチケット一覧の視認性と操作フローを改善します。\n\n## 対応内容\nVS Codeで編集し、Redmineへ同期します。' };
  state.selectedProject = { id: 1, name: 'eCookbook' };
  state.projects = [{ id: 1, name: 'eCookbook', level: 0 }];
  state.editOptions = { ticketId: 2816, projectId: 1, trackers: [{ id: 1, name: 'Bug' }], priorities: [{ id: 1, name: 'Normal' }], statuses: [], assignees: [], statusFallback: false, loading: false };
  await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.body.className='vscode-dark'`);
  await push();
  await evaluate(`if(document.getElementById('ticket-detail-toggle').getAttribute('aria-expanded')==='false') document.getElementById('ticket-detail-toggle').click(); document.querySelector('.tickets-layout').scrollTop=0; document.getElementById('ticket-scroll').scrollTop=0`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const preview = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'dashboard-preview.png'), Buffer.from(preview.data, 'base64'));
  await evaluate(`document.getElementById('ticket-detail-card').scrollIntoView();document.getElementById('metadata-edit-btn').click()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const metadataPreview = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'dashboard-metadata-preview.png'), Buffer.from(metadataPreview.data, 'base64'));
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate('window.cspViolations'), [], 'Dashboard は CSP 違反を発生させない');
  console.log('PASS: Detail操作/状態9種/読み取り専用preview、Metadata一括適用/キャンセル/失敗/接続切替、同期二重送信防止/成功/失敗、日本語、属性バッジ/エスケープ/表示件数、Settings セクション/編集/キーボード操作、折りたたみ維持、子チケット検索、メニューのキーボード操作/表示領域、タブ横断の新規作成、入力/フォーカス維持、下書き前の同期抑止、ローディング/エラー再試行、7画面幅、4テーマ');
  console.log('検証用 HTML: ' + fixture);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome.kill();
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
});
