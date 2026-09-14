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
const bootstrap = `<style nonce="ui-check">:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-button-background:#1456f0;--vscode-button-foreground:#fff;--vscode-focusBorder:#1456f0;--vscode-sideBar-background:#f0f0f0;--vscode-editor-background:#fff;--vscode-foreground:#222;--vscode-descriptionForeground:#45515e;--vscode-panel-border:#e5e7eb;--vscode-errorForeground:#b3261e;--vscode-editorWarning-foreground:#795e00;--vscode-testing-iconPassed:#16825d}:root:has(body.vscode-dark){--vscode-sideBar-background:#252526;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ddd;--vscode-descriptionForeground:#bbb;--vscode-panel-border:#666}:root:has(body.vscode-high-contrast-light){--vscode-contrastBorder:#000;--vscode-panel-border:#000}</style><script nonce="ui-check">window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m)});const NativeDate=Date;const fixedNow=NativeDate.UTC(2026,8,14,16,0,0);window.Date=class extends NativeDate{constructor(...args){if(args.length===0)super(fixedNow);else super(...args)}static now(){return fixedNow}};</script>`;
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
  await call('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
  await call('Page.bringToFront');
  await call('Page.navigate', { url: 'file://' + fixture });
  await evaluate(`new Promise(resolve=>{if(document.readyState==='complete')resolve();else window.addEventListener('load',resolve,{once:true})})`);
  assert.equal(await evaluate('document.documentElement.lang'), 'ja');
  await push();

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
  assert.equal(await evaluate('window.messages.filter(m=>m.type==="ticket.select").length'), 0);
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-expand="10"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.activeElement.dataset.expand`), '10');
  await evaluate(`document.getElementById('search-input').value='検索対象'; document.getElementById('search-input').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-row').dataset.id`), '11');
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

  // 全タブから新規作成でき、更新中も入力値と選択範囲を保持する。
  await evaluate(`document.getElementById('tab-settings').click(); document.getElementById('new-ticket-btn').click()`);
  assert.equal(await evaluate(`document.getElementById('tab-tickets').getAttribute('aria-selected')`), 'true');
  state.workPanel = { mode: 'newTicket', projectId: 1, projectName: '検証プロジェクト', loading: false, trackers: [{ id: 1, name: 'バグ' }], priorities: [{ id: 1, name: '通常' }], assignees: [], statuses: [], values: { tracker: 'バグ', priority: '通常' } };
  await push();
  assert.equal(await evaluate('document.activeElement.id'), 'work-tracker');
  assert.equal(await evaluate(`document.getElementById('work-sync-new-ticket').disabled`), true);
  assert.equal(await evaluate(`document.getElementById('work-tracker').required`), true);
  await evaluate(`const input=document.getElementById('work-description'); input.value='入力途中の説明'; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(2,4)`);
  await push();
  assert.deepEqual(await evaluate(`({id:document.activeElement.id,value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})`), { id: 'work-description', value: '入力途中の説明', start: 2, end: 4 });
  await call('Emulation.setDeviceMetricsOverride', { width: 280, height: 600, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`document.getElementById('ticket-detail-card').getBoundingClientRect().right <= innerWidth`), true);
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
  state.tickets = Array.from({ length: 20 }, (_, index) => ({ id: 10 + index, subject: 'チケットの詳細と操作を確認するための長い件名 ' + index, level: 0, statusName: '進行中', syncState: 'Queued', dueDate: '2020-01-01', children: [] }));
  state.selectedTicketId = 10;
  state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '日本語の説明文と状態表示を確認します。\nキーボードと画面幅に合わせて操作できます。' };
  for (const [theme, width] of [['vscode-light', 320], ['vscode-dark', 1200], ['vscode-high-contrast-light', 480]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(theme)};document.getElementById('tab-tickets').click()`);
    await push();
    if (theme === 'vscode-dark') assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(37, 37, 38)');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.due-overdue')).display !== 'none'`), true);
    assert.equal(await evaluate(`document.querySelector('.tickets-master').scrollWidth <= document.querySelector('.tickets-master').clientWidth`), true);
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
  assert.deepEqual(errors, []);
  console.log('PASS: 日本語、Settings セクション/編集/キーボード操作、折りたたみ維持、子チケット検索、メニューのキーボード操作/表示領域、タブ横断の新規作成、入力/フォーカス維持、下書き前の同期抑止、ローディング/エラー再試行、5画面幅、3テーマ');
  console.log('検証用 HTML: ' + fixture);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome.kill();
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
});
