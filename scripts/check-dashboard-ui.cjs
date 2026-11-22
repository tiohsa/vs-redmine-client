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
const bootstrap = `<style nonce="ui-check">:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-button-background:#1456f0;--vscode-button-foreground:#fff;--vscode-focusBorder:#1456f0;--vscode-sideBar-background:#f0f0f0;--vscode-editor-background:#fff;--vscode-foreground:#222;--vscode-descriptionForeground:#45515e;--vscode-panel-border:#e5e7eb;--vscode-errorForeground:#b3261e;--vscode-editorWarning-foreground:#795e00;--vscode-testing-iconPassed:#16825d}:root:has(body.vscode-dark){--vscode-sideBar-background:#252526;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ddd;--vscode-descriptionForeground:#bbb;--vscode-panel-border:#2b2b2b;--vscode-button-background:#007acc;--vscode-focusBorder:#007acc;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-editorWidget-background:#252526}:root:has(body.vscode-high-contrast-light){--vscode-contrastBorder:#000;--vscode-panel-border:#000}:root:has(body.vscode-high-contrast){--vscode-sideBar-background:#000;--vscode-editor-background:#000;--vscode-foreground:#fff;--vscode-descriptionForeground:#fff;--vscode-contrastBorder:#fff;--vscode-focusBorder:#f38518;--vscode-panel-border:#fff}</style><script nonce="ui-check">window.messages=[];let uiState=window.__initialUiState;window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m),getState:()=>uiState,setState:value=>{uiState=value;return value}});const NativeDate=Date;const fixedNow=NativeDate.UTC(2026,8,14,16,0,0);window.Date=class extends NativeDate{constructor(...args){if(args.length===0)super(fixedNow);else super(...args)}static now(){return fixedNow}};</script>`;
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
async function typeText(value) {
  for (const character of value) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: character });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
  }
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
async function checkLoadMoreState() {
  const original = structuredClone(state);
  await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
  const node = id => ({ id, subject: `Ticket ${id}`, level: 0, children: [] });
  const position = () => evaluate(`(()=>{const scroll=document.getElementById('ticket-scroll');const top=scroll.getBoundingClientRect().top;const row=[...document.querySelectorAll('.ticket-row')].find(row=>row.getBoundingClientRect().bottom>top);return {id:row?.dataset.id,offset:row?.getBoundingClientRect().top-top}})()`);
  for (const query of ['', '検索']) {
    state.ticketSearch = { query, scope: { kind: 'project', projectId: 1 }, includeChildProjects: false };
    state.tickets = Array.from({ length: 30 }, (_, i) => node((i + 1) * 10));
    state.loadedTicketCount = 30;
    state.hasMoreTickets = true;
    state.loading = { ...state.loading, tickets: false, moreTickets: false };
    state.errors = {};
    await push();
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await evaluate(`document.getElementById('load-more-row').focus();document.getElementById('ticket-scroll').scrollTop=100000;window.oldRow=document.querySelector('.ticket-row');window.messages.length=0;document.getElementById('load-more-row').click();document.getElementById('load-more-row').click()`);
    assert.equal(await evaluate(`window.messages.filter(message=>message.type==='tickets.loadMore').length`), 1, '追加要求を連打しても1回だけ送信');
    const before = await position();
    state.loading.moreTickets = true;
    await push();
    assert.equal(await evaluate(`window.oldRow===document.querySelector('.ticket-row')`), true, '追加取得開始時に既存DOMを保持');
    assert.deepEqual(await position(), before, '追加取得開始時に表示位置を保持');
    assert.equal(await evaluate(`document.activeElement.id`), 'load-more-row');
    assert.equal(await evaluate(`document.getElementById('load-more-row').getAttribute('aria-disabled')`), 'true');
    assert.equal(await evaluate(`document.querySelector('.loading-state')===null`), true);
    // ソートで先頭に新しい行が入っても、見ていた行の相対位置を保持する。
    state.tickets = [node(5), ...state.tickets, node(310)];
    state.loadedTicketCount = state.tickets.length;
    await push();
    assert.deepEqual(await position(), before, '追加行を挿入しても表示位置を保持');
    state.loading.moreTickets = false;
    await push();
    assert.equal(await evaluate(`document.activeElement.id`), 'load-more-row');
    // 失敗は一覧の下に表示し、同じボタンから追加取得だけを再試行する。
    await evaluate(`window.oldRow=document.querySelector('.ticket-row')`);
    state.loading.moreTickets = true;
    await push();
    state.loading.moreTickets = false;
    state.errors.moreTickets = '追加取得に失敗しました';
    await push();
    assert.equal(await evaluate(`window.oldRow===document.querySelector('.ticket-row')`), true);
    assert.equal(await evaluate(`document.getElementById('load-more-error').textContent`), state.errors.moreTickets);
    assert.equal(await evaluate(`document.activeElement.id`), 'load-more-row');
    await evaluate(`document.getElementById('load-more-row').click()`);
    assert.equal(await evaluate(`window.messages.at(-1).type`), 'tickets.loadMore');
    state.errors = {};
    state.loading.moreTickets = true;
    await push();
    const finalPosition = await position();
    state.tickets.push(node(320));
    state.loadedTicketCount = state.tickets.length;
    state.hasMoreTickets = false;
    await push();
    state.loading.moreTickets = false;
    await push();
    assert.equal(await evaluate(`document.activeElement.dataset.id`), '320', '最終ページでは最初の追加行へフォーカス');
    assert.deepEqual(await position(), finalPosition);
    // 重複だけの最終ページは件数表示へフォーカスを戻す。
    state.hasMoreTickets = true;
    await push();
    await evaluate(`document.getElementById('load-more-row').focus()`);
    state.loading.moreTickets = true;
    await push();
    state.hasMoreTickets = false;
    state.loading.moreTickets = false;
    await push();
    assert.equal(await evaluate(`document.activeElement.id`), 'ticket-count');
  }
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, original);
  await push();
  // 長い一覧から戻した際の scroll イベントが、次の picker 操作へ残らないよう待つ。
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
}
async function checkTicketSelectionHighlight() {
  const originalState = structuredClone(state);
  const originalBodyClass = await evaluate(`document.body.className`);
  const originalCompact = await evaluate(`document.getElementById('ticket-list').classList.contains('is-compact')`);
  const tokenNames = [
    '--vscode-list-hoverBackground',
    '--vscode-list-inactiveSelectionBackground',
    '--vscode-list-activeSelectionBackground',
    '--vscode-list-activeSelectionForeground',
  ];
  const isSoftBlue = (c) => c.b > c.r && c.b > c.g;
  await evaluate(`(() => {
    if (window.__selectionColorHelper) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const parse = (cssColor) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const over = (fg, bg) => {
      const t = fg.a / 255;
      return {
        r: Math.round(fg.r * t + bg.r * (1 - t)),
        g: Math.round(fg.g * t + bg.g * (1 - t)),
        b: Math.round(fg.b * t + bg.b * (1 - t)),
        a: 255,
      };
    };
    const linear = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const luminance = (c) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
    const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    const key = (c) => c.r + ',' + c.g + ',' + c.b + ',' + c.a;
    window.__selectionColorHelper = { parse, over, contrast, distance, key };
  })()`);

  const setTokens = async (tokens) => {
    await evaluate(`(() => {
      const root = document.documentElement.style;
      for (const name of ${JSON.stringify(tokenNames)}) {
        const value = ${JSON.stringify(tokens)}[name];
        if (value === undefined) root.removeProperty(name);
        else root.setProperty(name, value);
      }
    })()`);
  };

  const measureSelection = async (selector) => evaluate(`(() => {
    const helper = window.__selectionColorHelper;
    const scroll = document.getElementById('ticket-scroll');
    const row = document.querySelector(${JSON.stringify(selector)});
    const subject = row.querySelector('.ticket-subject');
    const rowStyle = getComputedStyle(row);
    const scrollBg = helper.parse(getComputedStyle(scroll).backgroundColor);
    const rawRowBg = helper.parse(rowStyle.backgroundColor);
    const resolvedRowBg = helper.over(rawRowBg, scrollBg);
    const subjectColor = helper.parse(getComputedStyle(subject).color);
    return {
      focusWithin: document.querySelector('body:focus-within') !== null,
      rawAlpha: rawRowBg.a,
      bg: resolvedRowBg,
      bgKey: helper.key(resolvedRowBg),
      scrollBgKey: helper.key(scrollBg),
      distanceFromScroll: helper.distance(resolvedRowBg, scrollBg),
      subjectContrast: helper.contrast(subjectColor, resolvedRowBg),
      outlineStyle: rowStyle.outlineStyle,
      borderLeftWidth: rowStyle.borderLeftWidth,
      paddingLeft: rowStyle.paddingLeft,
    };
  })()`);

  const measureCommentSelection = async (selector) => evaluate(`(() => {
    const helper = window.__selectionColorHelper;
    const bodyBg = helper.parse(getComputedStyle(document.body).backgroundColor);
    const detailCard = document.getElementById('ticket-detail-card');
    const detailBg = helper.over(helper.parse(getComputedStyle(detailCard).backgroundColor), bodyBg);
    const card = document.querySelector(${JSON.stringify(selector)});
    const cardStyle = getComputedStyle(card);
    const rawCardBg = helper.parse(cardStyle.backgroundColor);
    const resolvedCardBg = helper.over(rawCardBg, detailBg);
    const bodyColor = helper.parse(getComputedStyle(card.querySelector('.comment-body')).color);
    const authorColor = helper.parse(getComputedStyle(card.querySelector('.comment-author')).color);
    return {
      focusWithin: document.querySelector('body:focus-within') !== null,
      rawAlpha: rawCardBg.a,
      bg: resolvedCardBg,
      bgKey: helper.key(resolvedCardBg),
      detailBgKey: helper.key(detailBg),
      distanceFromDetail: helper.distance(resolvedCardBg, detailBg),
      bodyContrast: helper.contrast(bodyColor, resolvedCardBg),
      authorContrast: helper.contrast(authorColor, resolvedCardBg),
      boxShadow: cardStyle.boxShadow,
      outlineStyle: cardStyle.outlineStyle,
    };
  })()`);

  try {
    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.getElementById('tab-tickets').click()`);
    state.selectedProject = { id: 1, name: '検証プロジェクト' };
    state.projects = [{ id: 1, name: '検証プロジェクト', level: 0 }];
    state.metadataOptions.statuses = [{ id: 1, name: '進行中', isClosed: false }];
    state.draftTickets = [{
      queueId: 'sel-draft',
      documentUri: 'file:///tmp/selection-draft.md',
      subject: '選択確認ドラフト',
      projectId: 1,
      trackerName: 'Bug',
      statusName: '進行中',
      priorityName: 'Normal',
      syncState: 'Draft',
    }];
    state.tickets = [
      {
        id: 510,
        subject: '通常選択確認チケット',
        level: 0,
        trackerName: 'Bug',
        statusId: 1,
        statusName: '進行中',
        syncState: 'Synced',
        children: [{
          id: 511,
          subject: '子チケット選択確認',
          level: 1,
          trackerName: 'Feature',
          statusId: 1,
          statusName: '進行中',
          syncState: 'Synced',
          children: [],
        }],
      },
      {
        id: 512,
        subject: '未同期選択確認チケット',
        level: 0,
        trackerName: 'Task',
        statusId: 1,
        statusName: '進行中',
        syncState: 'Dirty',
        children: [],
      },
    ];
    state.loadedTicketCount = 3;
    state.totalTicketCount = 3;
    state.selectedTicketId = 510;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト' };
    state.comments = {
      ticketId: 510,
      loading: false,
      items: [
        {
          id: 901,
          noteIndex: 1,
          authorName: 'Taro',
          body: 'リモート選択確認コメント',
          updatedAt: '2026-09-14T10:00:00Z',
          editableByCurrentUser: true,
          isEditing: false,
          hasUnsyncedEdit: false,
        },
        {
          authorName: 'Local draft',
          body: 'ローカル下書き選択確認コメント',
          editableByCurrentUser: false,
          hasUnsyncedEdit: true,
          isLocalUnsynced: true,
          syncKey: { kind: 'comment', ticketId: 510, documentUri: 'file:///tmp/sel-comment-draft.md' },
        },
      ],
      selectedCommentId: 901,
      selectedCommentUri: undefined,
    };
    await push();

    // トラッカー縦バーが存在せず、左パディングとインデントガイドが維持される。
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-tracker-bar').length`), 0, 'no ticket tracker bar');
    assert.equal(await evaluate(`document.querySelectorAll('.detail-tracker-bar').length`), 0, 'no detail tracker bar');
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-row[data-id="511"] .ticket-indent-guide').length`), 1, 'child indent guide intact');
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-row[data-id="511"] .ticket-indent-branch').length`), 1, 'child indent branch intact');

    const themedCases = [
      {
        theme: 'vscode-light',
        tokens: {
          '--vscode-list-hoverBackground': '#e8e8e8',
          '--vscode-list-inactiveSelectionBackground': '#e4e6f1',
          '--vscode-list-activeSelectionBackground': '#0060c0',
          '--vscode-list-activeSelectionForeground': '#ffffff',
        },
      },
      {
        theme: 'vscode-dark',
        tokens: {
          '--vscode-list-hoverBackground': '#2a2d2e',
          '--vscode-list-inactiveSelectionBackground': '#37373d',
          '--vscode-list-activeSelectionBackground': '#094771',
          '--vscode-list-activeSelectionForeground': '#ffffff',
        },
      },
    ];

    for (const { theme, tokens } of themedCases) {
      await evaluate(`document.body.className=${JSON.stringify(theme)}`);
      await setTokens(tokens);
      state.comments.selectedCommentId = 901;
      state.comments.selectedCommentUri = undefined;
      await push();
      await evaluate(`document.activeElement?.blur?.()`);
      const inactive = await measureSelection('.ticket-row[data-id="510"].selected');
      assert.equal(inactive.focusWithin, false, `${theme}: inactive focusWithin`);
      assert.ok(inactive.rawAlpha > 0, `${theme}: inactive alpha`);
      assert.equal(inactive.borderLeftWidth, '0px', `${theme}: selected ticket has no left border`);
      assert.equal(inactive.paddingLeft, '12px', `${theme}: level 0 paddingLeft intact`);
      assert.ok(isSoftBlue(inactive.bg), `${theme}: ticket inactive soft blue ${JSON.stringify(inactive.bg)}`);
      assert.notEqual(inactive.bgKey, inactive.scrollBgKey, `${theme}: inactive differs from list`);
      const baseline = await evaluate(`(() => {
        const helper = window.__selectionColorHelper;
        const scrollBg = helper.parse(getComputedStyle(document.getElementById('ticket-scroll')).backgroundColor);
        const hover = helper.parse(${JSON.stringify(tokens['--vscode-list-hoverBackground'])});
        const rawInactive = helper.parse(${JSON.stringify(tokens['--vscode-list-inactiveSelectionBackground'])});
        return {
          hoverKey: helper.key(hover),
          rawInactiveKey: helper.key(rawInactive),
          rawInactiveDistance: helper.distance(rawInactive, scrollBg),
        };
      })()`);
      assert.notEqual(inactive.bgKey, baseline.hoverKey, `${theme}: inactive differs from hover`);
      assert.notEqual(inactive.bgKey, baseline.rawInactiveKey, `${theme}: inactive differs from raw token`);
      assert.ok(inactive.distanceFromScroll > baseline.rawInactiveDistance, `${theme}: inactive strengthens contrast`);
      assert.ok(inactive.subjectContrast >= 4.5, `${theme}: inactive contrast ${inactive.subjectContrast}`);

      const commentInactive = await measureCommentSelection('.comment-card[data-comment-id="901"].selected');
      assert.equal(commentInactive.focusWithin, false, `${theme}: comment inactive focusWithin`);
      assert.ok(commentInactive.rawAlpha > 0, `${theme}: comment inactive alpha`);
      assert.equal(commentInactive.boxShadow, 'none', `${theme}: comment selected has no left inset shadow`);
      assert.ok(isSoftBlue(commentInactive.bg), `${theme}: comment inactive soft blue ${JSON.stringify(commentInactive.bg)}`);
      assert.notEqual(commentInactive.bgKey, commentInactive.detailBgKey, `${theme}: comment inactive differs from detail bg`);
      assert.notEqual(commentInactive.bgKey, baseline.hoverKey, `${theme}: comment inactive differs from hover`);
      assert.ok(commentInactive.bodyContrast >= 4.5, `${theme}: comment inactive body contrast ${commentInactive.bodyContrast}`);
      assert.ok(commentInactive.authorContrast >= 4.5, `${theme}: comment inactive author contrast ${commentInactive.authorContrast}`);

      await evaluate(`document.querySelector('.ticket-row[data-id="510"]').focus()`);
      const active = await measureSelection('.ticket-row[data-id="510"].selected');
      assert.equal(active.focusWithin, true, `${theme}: active focusWithin`);
      assert.ok(isSoftBlue(active.bg), `${theme}: ticket active soft blue ${JSON.stringify(active.bg)}`);
      assert.notEqual(active.bgKey, active.scrollBgKey, `${theme}: active differs from list`);
      assert.notEqual(active.bgKey, inactive.bgKey, `${theme}: active differs from inactive`);
      assert.ok(active.distanceFromScroll >= inactive.distanceFromScroll, `${theme}: active >= inactive`);
      assert.ok(active.subjectContrast >= 4.5, `${theme}: active contrast ${active.subjectContrast}`);

      await evaluate(`document.querySelector('.comment-card[data-comment-id="901"]').focus()`);
      const commentActive = await measureCommentSelection('.comment-card[data-comment-id="901"].selected');
      assert.equal(commentActive.focusWithin, true, `${theme}: comment active focusWithin`);
      assert.equal(commentActive.boxShadow, 'none', `${theme}: comment active boxShadow none`);
      assert.ok(isSoftBlue(commentActive.bg), `${theme}: comment active soft blue ${JSON.stringify(commentActive.bg)}`);
      assert.notEqual(commentActive.bgKey, commentActive.detailBgKey, `${theme}: comment active differs from detail bg`);
      assert.notEqual(commentActive.bgKey, baseline.hoverKey, `${theme}: comment active differs from hover`);
      assert.notEqual(commentActive.bgKey, commentInactive.bgKey, `${theme}: comment active differs from inactive`);
      assert.ok(commentActive.bodyContrast >= 4.5, `${theme}: comment active body contrast ${commentActive.bodyContrast}`);
      assert.ok(commentActive.authorContrast >= 4.5, `${theme}: comment active author contrast ${commentActive.authorContrast}`);

      // ローカル下書きコメント選択もリモート選択と一貫したソフトブルー背景を持つ。
      state.comments.selectedCommentId = undefined;
      state.comments.selectedCommentUri = 'file:///tmp/sel-comment-draft.md';
      await push();
      await evaluate(`document.activeElement?.blur?.()`);
      const draftCommentInactive = await measureCommentSelection('.comment-card[data-comment-uri="file:///tmp/sel-comment-draft.md"].selected');
      assert.equal(draftCommentInactive.bgKey, commentInactive.bgKey, `${theme}: draft comment inactive matches remote`);
      assert.equal(draftCommentInactive.boxShadow, 'none', `${theme}: draft comment boxShadow none`);
      assert.ok(isSoftBlue(draftCommentInactive.bg), `${theme}: draft comment inactive soft blue`);
      assert.ok(draftCommentInactive.bodyContrast >= 4.5, `${theme}: draft comment inactive body contrast`);
      await evaluate(`document.querySelector('.comment-card[data-comment-uri="file:///tmp/sel-comment-draft.md"]').focus()`);
      const draftCommentActive = await measureCommentSelection('.comment-card[data-comment-uri="file:///tmp/sel-comment-draft.md"].selected');
      assert.equal(draftCommentActive.bgKey, commentActive.bgKey, `${theme}: draft comment active matches remote`);
      assert.ok(isSoftBlue(draftCommentActive.bg), `${theme}: draft comment active soft blue`);
      assert.ok(draftCommentActive.bodyContrast >= 4.5, `${theme}: draft comment active body contrast`);

      state.comments.selectedCommentId = 901;
      state.comments.selectedCommentUri = undefined;
      await push();

      // 未定義トークン時のフォールバック検証
      await setTokens({
        '--vscode-list-hoverBackground': 'initial',
        '--vscode-list-inactiveSelectionBackground': 'initial',
        '--vscode-list-activeSelectionBackground': 'initial',
        '--vscode-list-activeSelectionForeground': 'initial',
      });
      await evaluate(`document.activeElement?.blur?.()`);
      const fallbackInactive = await measureSelection('.ticket-row[data-id="510"].selected');
      assert.equal(fallbackInactive.focusWithin, false);
      assert.ok(fallbackInactive.rawAlpha > 0, `${theme}: fallback inactive alpha`);
      assert.ok(isSoftBlue(fallbackInactive.bg), `${theme}: fallback ticket inactive soft blue`);
      assert.notEqual(fallbackInactive.bgKey, fallbackInactive.scrollBgKey, `${theme}: fallback inactive differs from list`);
      assert.ok(fallbackInactive.subjectContrast >= 4.5, `${theme}: fallback inactive contrast ${fallbackInactive.subjectContrast}`);

      const fallbackCommentInactive = await measureCommentSelection('.comment-card[data-comment-id="901"].selected');
      assert.equal(fallbackCommentInactive.boxShadow, 'none', `${theme}: fallback comment boxShadow none`);
      assert.ok(isSoftBlue(fallbackCommentInactive.bg), `${theme}: fallback comment inactive soft blue`);
      assert.notEqual(fallbackCommentInactive.bgKey, fallbackCommentInactive.detailBgKey, `${theme}: fallback comment inactive differs from detail`);
      assert.ok(fallbackCommentInactive.bodyContrast >= 4.5, `${theme}: fallback comment inactive contrast`);

      await evaluate(`document.querySelector('.ticket-row[data-id="510"]').focus()`);
      const fallbackActive = await measureSelection('.ticket-row[data-id="510"].selected');
      assert.equal(fallbackActive.focusWithin, true);
      assert.ok(fallbackActive.rawAlpha > 0, `${theme}: fallback active alpha`);
      assert.ok(isSoftBlue(fallbackActive.bg), `${theme}: fallback ticket active soft blue`);
      assert.notEqual(fallbackActive.bgKey, fallbackActive.scrollBgKey, `${theme}: fallback active differs from list`);
      assert.notEqual(fallbackActive.bgKey, fallbackInactive.bgKey, `${theme}: fallback active differs from inactive`);
      assert.ok(fallbackActive.subjectContrast >= 4.5, `${theme}: fallback active contrast ${fallbackActive.subjectContrast}`);

      await evaluate(`document.querySelector('.comment-card[data-comment-id="901"]').focus()`);
      const fallbackCommentActive = await measureCommentSelection('.comment-card[data-comment-id="901"].selected');
      assert.equal(fallbackCommentActive.boxShadow, 'none', `${theme}: fallback comment active boxShadow none`);
      assert.ok(isSoftBlue(fallbackCommentActive.bg), `${theme}: fallback comment active soft blue`);
      assert.notEqual(fallbackCommentActive.bgKey, fallbackCommentInactive.bgKey, `${theme}: fallback comment active differs from inactive`);
      assert.ok(fallbackCommentActive.bodyContrast >= 4.5, `${theme}: fallback comment active contrast`);
    }

    // 全行種別・コンパクトモードの一貫性と左ボーダーなし・パディング維持
    await evaluate(`document.body.className='vscode-dark'`);
    await setTokens(themedCases[1].tokens);
    for (const compact of [false, true]) {
      await evaluate(`document.getElementById('ticket-list').classList.toggle('is-compact', ${compact})`);
      state.selectedTicketId = 510;
      state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト' };
      await push();
      assert.equal(await evaluate(`document.querySelectorAll('.ticket-tracker-bar, .detail-tracker-bar').length`), 0, `compact=${compact}: no tracker bars`);
      await evaluate(`document.activeElement?.blur?.()`);
      const normalInactive = await measureSelection('.ticket-row[data-id="510"].selected');
      const childUnselected = await measureSelection('.ticket-row[data-id="511"]');
      const unsyncedUnselected = await measureSelection('.ticket-row[data-id="512"]');
      assert.equal(normalInactive.borderLeftWidth, '0px', `compact=${compact} normal borderLeftWidth`);
      assert.equal(normalInactive.paddingLeft, '12px', `compact=${compact} normal paddingLeft`);
      assert.equal(childUnselected.borderLeftWidth, '0px', `compact=${compact} child borderLeftWidth`);
      assert.equal(childUnselected.paddingLeft, '26px', `compact=${compact} child paddingLeft`);
      assert.equal(unsyncedUnselected.borderLeftWidth, '0px', `compact=${compact} unsynced borderLeftWidth`);
      assert.equal(unsyncedUnselected.paddingLeft, '12px', `compact=${compact} unsynced paddingLeft`);
      await evaluate(`document.querySelector('.ticket-row[data-id="510"]').focus()`);
      const normalActive = await measureSelection('.ticket-row[data-id="510"].selected');

      for (const ticket of [state.tickets[0].children[0], state.tickets[1]]) {
        state.selectedTicketId = ticket.id;
        state.selectedTicket = { ...ticket, projectName: '検証プロジェクト' };
        await push();
        await evaluate(`document.activeElement?.blur?.()`);
        const rowInactive = await measureSelection(`.ticket-row[data-id="${ticket.id}"].selected`);
        assert.equal(rowInactive.borderLeftWidth, '0px', `compact=${compact} id=${ticket.id} borderLeftWidth`);
        assert.equal(rowInactive.bgKey, normalInactive.bgKey, `compact=${compact} id=${ticket.id} inactive`);
        assert.ok(isSoftBlue(rowInactive.bg), `compact=${compact} id=${ticket.id} soft blue`);
        assert.notEqual(rowInactive.bgKey, unsyncedUnselected.bgKey, `compact=${compact} id=${ticket.id} != unsynced`);
        await evaluate(`document.querySelector('.ticket-row[data-id="${ticket.id}"]').focus()`);
        const rowActive = await measureSelection(`.ticket-row[data-id="${ticket.id}"].selected`);
        assert.equal(rowActive.bgKey, normalActive.bgKey, `compact=${compact} id=${ticket.id} active`);
      }

      await evaluate(`document.querySelector('.ticket-row.is-draft').click()`);
      await evaluate(`document.activeElement?.blur?.()`);
      const draftInactive = await measureSelection('.ticket-row.is-draft.selected');
      assert.equal(draftInactive.borderLeftWidth, '0px', `compact=${compact} draft borderLeftWidth`);
      assert.equal(draftInactive.paddingLeft, '12px', `compact=${compact} draft paddingLeft`);
      assert.equal(draftInactive.bgKey, normalInactive.bgKey, `compact=${compact} draft inactive`);
      assert.ok(isSoftBlue(draftInactive.bg), `compact=${compact} draft soft blue`);
      assert.notEqual(draftInactive.bgKey, unsyncedUnselected.bgKey, `compact=${compact} draft != unsynced`);
      await evaluate(`document.querySelector('.ticket-row.is-draft').focus()`);
      const draftActive = await measureSelection('.ticket-row.is-draft.selected');
      assert.equal(draftActive.bgKey, normalActive.bgKey, `compact=${compact} draft active`);
    }

    // High Contrast 維持（チケット行・コメント行の双方）
    await evaluate(`document.getElementById('ticket-list').classList.remove('is-compact')`);
    state.selectedTicketId = 510;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト' };
    state.comments.selectedCommentId = 901;
    state.comments.selectedCommentUri = undefined;
    await push();
    await setTokens({});
    for (const hcTheme of ['vscode-high-contrast', 'vscode-high-contrast-light']) {
      await evaluate(`document.body.className=${JSON.stringify(hcTheme)}`);
      await evaluate(`document.activeElement?.blur?.()`);
      const hcInactive = await measureSelection('.ticket-row[data-id="510"].selected');
      assert.notEqual(hcInactive.outlineStyle, 'none', `${hcTheme}: ticket outline`);
      assert.ok(hcInactive.rawAlpha > 0, `${hcTheme}: ticket alpha`);
      assert.ok(hcInactive.subjectContrast >= 4.5, `${hcTheme}: ticket contrast ${hcInactive.subjectContrast}`);
      const hcCommentInactive = await measureCommentSelection('.comment-card[data-comment-id="901"].selected');
      assert.notEqual(hcCommentInactive.outlineStyle, 'none', `${hcTheme}: comment outline`);
      assert.ok(hcCommentInactive.rawAlpha > 0, `${hcTheme}: comment alpha`);
      assert.ok(hcCommentInactive.bodyContrast >= 4.5, `${hcTheme}: comment contrast ${hcCommentInactive.bodyContrast}`);
    }
  } finally {
    await setTokens({});
    await evaluate(`document.body.className=${JSON.stringify(originalBodyClass)}`);
    await evaluate(`document.getElementById('ticket-list').classList.toggle('is-compact', ${originalCompact})`);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, originalState);
    await push();
    await evaluate(`document.activeElement?.blur?.()`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  }
}

async function checkDetailPanelResize() {
  const originalState = structuredClone(state);
  const originalBodyClass = await evaluate(`document.body.className`);
  const waitFrames = async (target = sessionId) => {
    await call('Runtime.evaluate', {
      expression: `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      returnByValue: true,
      awaitPromise: true,
    }, target);
  };
  const readMetrics = async () => evaluate(`(() => {
    const layout = document.querySelector('.tickets-layout');
    const master = document.querySelector('.tickets-master');
    const detail = document.querySelector('.tickets-detail');
    const handle = document.getElementById('detail-resize-handle');
    const handleStyle = getComputedStyle(handle);
    return {
      layoutHeight: layout.getBoundingClientRect().height,
      layoutScrollHeight: layout.scrollHeight,
      layoutClientHeight: layout.clientHeight,
      masterHeight: master.getBoundingClientRect().height,
      detailHeight: detail.getBoundingClientRect().height,
      handleRect: handle.getBoundingClientRect().toJSON(),
      handleDisplay: handleStyle.display,
      handleCursor: handleStyle.cursor,
      role: handle.getAttribute('role'),
      ariaOrientation: handle.getAttribute('aria-orientation'),
      ariaControls: handle.getAttribute('aria-controls'),
      ariaValueMin: handle.getAttribute('aria-valuemin'),
      ariaValueMax: handle.getAttribute('aria-valuemax'),
      ariaValueNow: handle.getAttribute('aria-valuenow'),
      tabIndex: handle.tabIndex,
      cssVar: layout.style.getPropertyValue('--detail-panel-height').trim(),
      isResizing: document.body.classList.contains('is-resizing-detail'),
      isDragging: handle.classList.contains('is-dragging'),
      persistedPercent: uiState?.detailHeightPercent,
    };
  })()`);

  try {
    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className='vscode-dark';document.getElementById('tab-tickets').click()`);
    await evaluate(`document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'));if(document.getElementById('detail-focus-toggle').checked)document.getElementById('detail-focus-toggle').click();`);
    state.selectedProject = { id: 1, name: '検証プロジェクト' };
    state.projects = [{ id: 1, name: '検証プロジェクト', level: 0 }];
    state.tickets = Array.from({ length: 12 }, (_, idx) => ({
      id: 700 + idx,
      subject: `リサイズ検証チケット ${idx + 1}`,
      level: 0,
      statusName: '進行中',
      syncState: 'Synced',
      children: [],
    }));
    state.loadedTicketCount = state.tickets.length;
    state.totalTicketCount = state.tickets.length;
    state.selectedTicketId = 700;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト' };
    state.comments = {
      ticketId: 700,
      loading: false,
      items: [
        { id: 801, noteIndex: 1, authorName: 'Taro', body: 'リサイズ検証コメント1', editableByCurrentUser: true },
        { id: 802, noteIndex: 2, authorName: 'Hanako', body: 'リサイズ検証コメント2', editableByCurrentUser: false },
      ],
    };
    await push();
    await waitFrames();

    // auto モード・幅 440px・詳細表示時にハンドルが表示される。
    const initial = await readMetrics();
    assert.notEqual(initial.handleDisplay, 'none', 'resize handle visible at 440px auto');
    assert.equal(initial.handleCursor, 'ns-resize', 'resize handle cursor is ns-resize');
    assert.equal(initial.role, 'separator');
    assert.equal(initial.ariaOrientation, 'horizontal');
    assert.equal(initial.ariaControls, 'ticket-detail-card');
    assert.equal(initial.tabIndex, 0);
    assert.equal(initial.cssVar, '48%');
    assert.equal(initial.ariaValueNow, '48');

    // 右クリックではリサイズを開始しない。
    await evaluate(`window.messages.length=0`);
    const startX = Math.round(initial.handleRect.left + initial.handleRect.width / 2);
    const startY = Math.round(initial.handleRect.top + initial.handleRect.height / 2);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'right', buttons: 2, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY - 90, button: 'none', buttons: 2 });
    const duringRightClick = await readMetrics();
    assert.equal(duringRightClick.isResizing, false, 'right click does not start resize');
    assert.equal(Math.round(duringRightClick.detailHeight), Math.round(initial.detailHeight), 'right click does not change height');
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: startY - 90, button: 'right', buttons: 0, clickCount: 1 });

    // 左ボタンドラッグ（上方向・下方向）でリアルタイム更新し、postMessage 0件で解放時に永続化する。
    await evaluate(`window.messages.length=0`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY - 100, button: 'none', buttons: 1 });
    const midDragUp = await readMetrics();
    assert.equal(midDragUp.isResizing, true, 'body.is-resizing-detail active during drag');
    assert.equal(midDragUp.isDragging, true, 'handle.is-dragging active during drag');
    assert.ok(midDragUp.detailHeight > initial.detailHeight + 50, `drag up grew detail: ${midDragUp.detailHeight} vs ${initial.detailHeight}`);
    assert.equal(await evaluate(`window.messages.length`), 0, 'no postMessage during drag up');
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: startY - 100, button: 'left', buttons: 0, clickCount: 1 });
    const afterDragUp = await readMetrics();
    assert.equal(afterDragUp.isResizing, false, 'body.is-resizing-detail cleared after release');
    assert.equal(afterDragUp.isDragging, false, 'handle.is-dragging cleared after release');
    assert.equal(await evaluate(`window.messages.length`), 0, 'no postMessage after drag release');
    assert.ok(typeof afterDragUp.persistedPercent === 'number' && afterDragUp.persistedPercent > 48, `persisted detailHeightPercent > 48: ${afterDragUp.persistedPercent}`);

    const downStartY = Math.round(afterDragUp.handleRect.top + afterDragUp.handleRect.height / 2);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: downStartY, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: downStartY + 160, button: 'none', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: downStartY + 160, button: 'left', buttons: 0, clickCount: 1 });
    const afterDragDown = await readMetrics();
    assert.ok(afterDragDown.detailHeight < afterDragUp.detailHeight - 100, `drag down shrank detail: ${afterDragDown.detailHeight} vs ${afterDragUp.detailHeight}`);
    assert.ok(afterDragDown.persistedPercent < afterDragUp.persistedPercent, 'persisted percent decreased');
    assert.equal(await evaluate(`window.messages.length`), 0, 'no postMessage during drag down');

    // 極端な上下ドラッグでもチケット一覧 >= 100px、コメントパネル >= 120px にクランプする。
    const clampUpY = Math.round(afterDragDown.handleRect.top + afterDragDown.handleRect.height / 2);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: clampUpY, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: 10, button: 'none', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: 10, button: 'left', buttons: 0, clickCount: 1 });
    const clampedTop = await readMetrics();
    assert.ok(clampedTop.masterHeight >= 99.5, `clamped top keeps ticket list >= 100px: ${clampedTop.masterHeight}`);
    assert.ok(clampedTop.detailHeight >= 119.5, `clamped top keeps detail >= 120px: ${clampedTop.detailHeight}`);

    const clampDownY = Math.round(clampedTop.handleRect.top + clampedTop.handleRect.height / 2);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: clampDownY, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: 795, button: 'none', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: 795, button: 'left', buttons: 0, clickCount: 1 });
    const clampedBottom = await readMetrics();
    assert.ok(clampedBottom.detailHeight >= 119.5, `clamped bottom keeps detail >= 120px: ${clampedBottom.detailHeight}`);
    assert.ok(clampedBottom.masterHeight >= 99.5, `clamped bottom keeps ticket list >= 100px: ${clampedBottom.masterHeight}`);

    // ダブルクリックで 48% へリセットする。
    const dblY = Math.round(clampedBottom.handleRect.top + clampedBottom.handleRect.height / 2);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: dblY, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: dblY, button: 'left', buttons: 0, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: dblY, button: 'left', buttons: 1, clickCount: 2 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: dblY, button: 'left', buttons: 0, clickCount: 2 });
    const afterDblClick = await readMetrics();
    assert.equal(afterDblClick.cssVar, '48%', 'dblclick resets css var to 48%');
    assert.equal(afterDblClick.persistedPercent, 48, 'dblclick persists 48');
    assert.equal(afterDblClick.ariaValueNow, '48', 'dblclick resets aria-valuenow');

    // キーボード操作（ArrowUp / ArrowDown / Home / End / Enter）。
    await evaluate(`document.getElementById('detail-resize-handle').focus()`);
    await key('ArrowUp');
    const afterArrowUp = await readMetrics();
    assert.equal(afterArrowUp.persistedPercent, 53, 'ArrowUp adds 5%');
    assert.equal(afterArrowUp.ariaValueNow, '53');
    assert.ok(afterArrowUp.detailHeight > afterDblClick.detailHeight, 'ArrowUp increases detail height');

    await key('ArrowDown');
    const afterArrowDown = await readMetrics();
    assert.equal(afterArrowDown.persistedPercent, 48, 'ArrowDown subtracts 5%');
    assert.equal(afterArrowDown.ariaValueNow, '48');

    await key('Home');
    const afterHome = await readMetrics();
    assert.equal(afterHome.ariaValueNow, afterHome.ariaValueMin, 'Home moves to aria-valuemin');
    assert.ok(afterHome.detailHeight >= 119.5 && afterHome.detailHeight < 150, `Home detail height: ${afterHome.detailHeight}`);

    await key('End');
    const afterEnd = await readMetrics();
    assert.equal(afterEnd.ariaValueNow, afterEnd.ariaValueMax, 'End moves to aria-valuemax');
    assert.ok(afterEnd.masterHeight >= 99.5 && afterEnd.masterHeight < 150, `End master height: ${afterEnd.masterHeight}`);

    // ウィンドウ縮小時の再クランプと超低ビューポート（< 226px）の破綻防止。
    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 360, deviceScaleFactor: 1, mobile: false });
    await waitFrames();
    const afterShrink = await readMetrics();
    assert.ok(afterShrink.detailHeight >= 119.5, `shrink re-clamp detail >= 120px: ${afterShrink.detailHeight}`);
    assert.ok(afterShrink.masterHeight >= 99.5, `shrink re-clamp master >= 100px: ${afterShrink.masterHeight}`);
    assert.ok(afterShrink.layoutScrollHeight <= afterShrink.layoutClientHeight + 1, 'shrink has no vertical overflow');

    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 240, deviceScaleFactor: 1, mobile: false });
    await waitFrames();
    const ultraShort = await readMetrics();
    assert.ok(ultraShort.layoutHeight < 226, `ultra-short layout height < 226px: ${ultraShort.layoutHeight}`);
    assert.ok(ultraShort.masterHeight > 20, `ultra-short master remains visible: ${ultraShort.masterHeight}`);
    assert.ok(ultraShort.detailHeight > 20, `ultra-short detail remains visible: ${ultraShort.detailHeight}`);
    assert.ok(!ultraShort.cssVar.includes('NaN') && !ultraShort.cssVar.startsWith('-'), `valid cssVar: ${ultraShort.cssVar}`);
    assert.ok(ultraShort.masterHeight + ultraShort.handleRect.height + ultraShort.detailHeight <= ultraShort.layoutHeight + 2, 'ultra-short panes do not overflow layout');

    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFrames();
    await evaluate(`document.getElementById('detail-resize-handle').focus()`);
    await key('Enter');
    const afterEnter = await readMetrics();
    assert.equal(afterEnter.cssVar, '48%', 'Enter resets to 48%');
    assert.equal(afterEnter.persistedPercent, 48);
    assert.equal(afterEnter.ariaValueNow, '48');

    // Reset View State で 48% へ戻り、保存済み detailHeightPercent が削除される。
    await key('ArrowUp');
    await key('ArrowUp');
    assert.equal((await readMetrics()).persistedPercent, 58);
    await evaluate(`document.getElementById('tab-settings').click();document.getElementById('settings-maintenance').open=true;document.getElementById('settings-reset-view-btn').click();document.getElementById('tab-tickets').click()`);
    await waitFrames();
    const afterResetView = await readMetrics();
    assert.equal(afterResetView.persistedPercent, undefined, 'Reset View State deletes saved detailHeightPercent');
    assert.equal(afterResetView.cssVar, '48%', 'Reset View State restores 48% height');
    assert.equal(afterResetView.ariaValueNow, '48');

    // 非対象モード・幅 >= 700px・詳細非表示時はハンドル非表示。
    state.selectedTicketId = undefined;
    state.selectedTicket = undefined;
    await push();
    assert.equal((await readMetrics()).handleDisplay, 'none', 'hidden when detail panel closed');

    state.selectedTicketId = 700;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト' };
    await push();
    assert.notEqual((await readMetrics()).handleDisplay, 'none', 'visible again when detail panel reopens');

    await call('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFrames();
    assert.equal((await readMetrics()).handleDisplay, 'none', 'hidden at width >= 700px');

    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFrames();
    for (const mode of ['split', 'single']) {
      await evaluate(`document.getElementById('ticket-layout-mode').value=${JSON.stringify(mode)};document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
      await waitFrames();
      assert.equal((await readMetrics()).handleDisplay, 'none', `hidden in layout-${mode}`);
    }
    await evaluate(`document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'));document.getElementById('detail-focus-toggle').click()`);
    await waitFrames();
    assert.equal((await readMetrics()).handleDisplay, 'none', 'hidden in layout-detail-focus');
    await evaluate(`document.getElementById('detail-focus-toggle').click()`);
    await waitFrames();
    assert.notEqual((await readMetrics()).handleDisplay, 'none', 'restored after exiting layout-detail-focus');

    // 初期状態に不正な detailHeightPercent が保存されている場合は 48% にフォールバックし、有効値は復元する。
    const { targetId: bootTargetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
    try {
      const { sessionId: bootSessionId } = await call('Target.attachToTarget', { targetId: bootTargetId, flatten: true }, null);
      await call('Runtime.enable', {}, bootSessionId);
      await call('Page.enable', {}, bootSessionId);
      await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false }, bootSessionId);
      const bootEval = async (expr) => {
        const res = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, bootSessionId);
        if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
        return res.result.value;
      };
      const bootCases = [
        { expr: '{ detailHeightPercent: NaN }', expectedVar: '48%', expectedAria: '48', label: 'NaN' },
        { expr: '{ detailHeightPercent: -5 }', expectedVar: '48%', expectedAria: '48', label: '-5' },
        { expr: '{ detailHeightPercent: 150 }', expectedVar: '48%', expectedAria: '48', label: '150' },
        { expr: `{ detailHeightPercent: 'bad' }`, expectedVar: '48%', expectedAria: '48', label: 'bad string' },
        { expr: '{ detailHeightPercent: 62 }', expectedVar: '62%', expectedAria: '62', label: 'valid 62' },
      ];
      for (const bootCase of bootCases) {
        const { identifier } = await call('Page.addScriptToEvaluateOnNewDocument', {
          source: `window.__initialUiState=${bootCase.expr};window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.effectiveDirective,blockedURI:e.blockedURI}));`,
        }, bootSessionId);
        await call('Page.navigate', { url: 'file://' + fixture }, bootSessionId);
        await bootEval(`new Promise(resolve=>{if(document.readyState==='complete')resolve();else window.addEventListener('load',resolve,{once:true})})`);
        await bootEval(`window.dispatchEvent(new MessageEvent('message',{data:{type:'dashboard.state',state:${JSON.stringify(state)}}}))`);
        await waitFrames(bootSessionId);
        const bootResult = await bootEval(`({
          cssVar: document.querySelector('.tickets-layout').style.getPropertyValue('--detail-panel-height').trim(),
          ariaNow: document.getElementById('detail-resize-handle').getAttribute('aria-valuenow'),
          cspViolations: window.cspViolations,
        })`);
        assert.equal(bootResult.cssVar, bootCase.expectedVar, `boot fallback/restore cssVar for ${bootCase.label}`);
        assert.equal(bootResult.ariaNow, bootCase.expectedAria, `boot fallback/restore aria-valuenow for ${bootCase.label}`);
        assert.deepEqual(bootResult.cspViolations, [], `no CSP violations on boot for ${bootCase.label}`);
        await call('Page.removeScriptToEvaluateOnNewDocument', { identifier }, bootSessionId);
      }
    } finally {
      await call('Target.closeTarget', { targetId: bootTargetId }, null);
    }
  } finally {
    await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(originalBodyClass)}`);
    await evaluate(`document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'));if(document.getElementById('detail-focus-toggle').checked)document.getElementById('detail-focus-toggle').click();`);
    await evaluate(`document.getElementById('tab-settings').click();document.getElementById('settings-maintenance').open=true;document.getElementById('settings-reset-view-btn').click();document.getElementById('tab-tickets').click();document.getElementById('toast-area').replaceChildren()`);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, originalState);
    await push();
    await evaluate(`document.activeElement?.blur?.()`);
    await waitFrames();
  }
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
  const focusTicketSearch = () => evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'view.focusTicketSearch' } }))`);
  await focusTicketSearch();
  assert.equal(await evaluate(`document.activeElement.id`), 'search-input');
  assert.deepEqual(await evaluate(`window.messages.map(message => message.type)`), ['dashboard.ready']);
  state.loading.tickets = true;
  await push();
  assert.equal(await evaluate(`document.activeElement.id`), 'search-input');
  await evaluate(`document.activeElement.blur()`);
  state.loading.tickets = false;
  // 重複排除で表示件数が総件数未満でも、API取得完了なら追加ボタンを隠す。
  state.totalTicketCount = 3;
  state.hasMoreTickets = true;
  await push();
  assert.equal(await evaluate(`document.getElementById('load-more-row').classList.contains('hidden')`), false);
  state.hasMoreTickets = false;
  await push();
  assert.equal(await evaluate(`document.getElementById('load-more-row').classList.contains('hidden')`), true);
  state.totalTicketCount = 2;
  await push();
  await checkLoadMoreState();
  assert.equal(await evaluate(`document.getElementById('search-input').type`), 'text');
  assert.equal(await evaluate(`document.getElementById('project-select-trigger').tagName`), 'BUTTON');
  assert.equal(await evaluate(`document.getElementById('project-select-trigger').getAttribute('aria-haspopup')`), 'dialog');
  assert.equal(await evaluate(`document.getElementById('project-search-input').type`), 'text');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('role')`), 'combobox');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-autocomplete')`), 'list');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-controls')`), 'project-listbox');
  // Project search is a Webview-local projection of the canonical hierarchy.
  const originalProjectsForProjectSearch = state.projects;
  const originalSelectedProjectForProjectSearch = state.selectedProject;
  state.projects = [
    { id: 1, name: 'Production', identifier: 'production', level: 0 },
    { id: 2, name: 'Japan', identifier: 'japan', parentId: 1, level: 1 },
    { id: 3, name: 'Nagoya Plant', identifier: 'plant-n6', parentId: 2, level: 2 },
    { id: 4, name: 'Tokyo Plant', identifier: 'tokyo', parentId: 2, level: 2 },
    { id: 5, name: 'USA', identifier: 'usa', parentId: 1, level: 1 },
    { id: 6, name: 'Development', identifier: 'development', level: 0 },
  ];
  state.selectedProject = { id: 5, name: 'USA' };
  await push();
  const projectNames = () => evaluate(`[...document.querySelectorAll('#project-listbox [role="option"] .project-option-name')].map(option=>option.textContent.trim())`);
  assert.deepEqual(await projectNames(), [strings.selectProjectPlaceholder, 'Production', 'Japan', 'Nagoya Plant', 'Tokyo Plant', 'USA', 'Development']);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  await evaluate(`document.getElementById('project-select-trigger').focus()`);
  await key('Enter');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'Enter opens project picker');
  assert.equal(await evaluate(`document.getElementById('project-select-trigger').getAttribute('aria-expanded')`), 'true');
  assert.equal(await evaluate(`document.activeElement.id`), 'project-search-input');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-5', 'selected project is initially active');
  await key('Escape');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  assert.equal(await evaluate(`document.activeElement.id`), 'project-select-trigger');
  await evaluate(`document.getElementById('project-select-trigger').focus()`);
  await key(' ', 'Space');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'Space opens project picker');
  await key('Escape');
  await evaluate(`document.getElementById('project-select-trigger').focus()`);
  await key('ArrowDown');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'ArrowDown opens project picker');
  assert.equal(await evaluate(`document.activeElement.id`), 'project-search-input');
  await key('Escape');
  await evaluate(`window.messages.length=0;document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-search-clear-btn').hidden`), false, 'custom project search clear button appears with a query');
  assert.deepEqual(await projectNames(), ['Production', 'Japan', 'Nagoya Plant', 'USA']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.project-group-label')).map(x=>x.textContent)`), [strings.projectSearchResults, strings.projectSelectedOutsideSearch]);
  assert.equal(await evaluate(`document.getElementById('project-select-label').textContent`), 'USA');
  assert.equal(await evaluate(`window.messages.length`), 0, 'project search must not post any message');
  assert.equal(await evaluate(`document.querySelector('#project-listbox [data-project-id="5"]').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  const assertProjectPopupBounds = () => evaluate(`(()=>{const r=document.getElementById('project-picker-popup').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && r.height<=320})()`);
  const settleViewport = () => evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await assertProjectPopupBounds(), true, 'project popup stays within viewport at 440px');
  let popupImage = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'project-picker-search-440.png'), Buffer.from(popupImage.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'viewport resize closes popup');
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await assertProjectPopupBounds(), true, 'project popup stays within viewport at 320px');
  popupImage = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'project-picker-search-320.png'), Buffer.from(popupImage.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 220, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'short viewport resize closes popup');
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  const shortViewportBounds = await evaluate(`(()=>{const r=document.getElementById('project-picker-popup').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight}})()`);
  assert.ok(shortViewportBounds.height < 320, `popup shrinks for short viewport: ${JSON.stringify(shortViewportBounds)}`);
  assert.ok(shortViewportBounds.top >= 0 && shortViewportBounds.bottom <= shortViewportBounds.viewport, `popup remains inside short viewport: ${JSON.stringify(shortViewportBounds)}`);
  await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'project picker reopens after viewport settles');
  await evaluate(`document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  const priorBodyClass = await evaluate(`document.body.className`);
  await evaluate(`document.body.className='vscode-dark'`);
  assert.equal(await assertProjectPopupBounds(), true, 'dark project popup stays within viewport at 440px');
  popupImage = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'project-picker-search-440-dark.png'), Buffer.from(popupImage.data, 'base64'));
  await evaluate(`document.body.className=${JSON.stringify(priorBodyClass)}`);
  for (const query of ['NAGOYA', 'ｎａｇｏｙａ']) {
    await evaluate(`document.getElementById('project-search-input').value=${JSON.stringify(query)};document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.deepEqual(await projectNames(), ['Production', 'Japan', 'Nagoya Plant', 'USA'], `query ${query}; input=${await evaluate(`document.getElementById('project-search-input').value`)}; open=${await evaluate(`!document.getElementById('project-picker-popup').hidden`)}`);
  }
  await push();
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'same-connection state updates keep popup open');
  assert.equal(await evaluate(`document.getElementById('project-search-input').value`), 'ｎａｇｏｙａ');
  assert.equal(await evaluate(`document.activeElement.id`), 'project-search-input');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  const projectsBeforeRemovalForActiveDescendant = state.projects;
  state.projects = state.projects.filter(project => project.id !== 3);
  await push();
  assert.equal(await evaluate(`document.getElementById('project-search-input').hasAttribute('aria-activedescendant')`), false, 'active descendant clears if the candidate disappears');
  state.projects = projectsBeforeRemovalForActiveDescendant;
  await push();
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  await evaluate(`document.getElementById('project-search-input').value='tokyo';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await projectNames(), ['Production', 'Japan', 'Tokyo Plant', 'USA']);
  const tokyoBounds = await evaluate(`(()=>{const r=document.querySelector('#project-listbox [data-project-id="4"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tokyoBounds.x, y: tokyoBounds.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: tokyoBounds.x, y: tokyoBounds.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tokyoBounds.x, y: tokyoBounds.y, button: 'left', clickCount: 1 });
  assert.deepEqual(await evaluate(`window.messages.filter(message=>message.type==='project.select').map(({type,projectId})=>({type,projectId}))`), [{ type: 'project.select', projectId: 4 }]);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  assert.equal(await evaluate(`document.activeElement.id`), 'project-select-trigger');
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await evaluate(`document.getElementById('project-search-input').value='plant-n6';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  await key('ArrowDown');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-5');
  await key('ArrowDown');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-5', 'ArrowDown stops at the end');
  await key('ArrowUp');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  await key('ArrowUp');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-2', 'ancestor rows remain keyboard selectable');
  await key('ArrowDown');
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-3');
  await evaluate(`document.getElementById('project-search-input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
  for (const composingKey of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape']) {
    assert.equal(await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:${JSON.stringify(composingKey)},isComposing:true,bubbles:true,cancelable:true});document.getElementById('project-search-input').dispatchEvent(e);return e.defaultPrevented})()`), false, `${composingKey} is ignored during IME composition`);
    assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, `${composingKey} keeps popup open during composition`);
  }
  await evaluate(`document.getElementById('project-search-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
  await key('Enter');
  assert.deepEqual(await evaluate(`window.messages.filter(message=>message.type==='project.select').map(({type,projectId})=>({type,projectId}))`), [{ type: 'project.select', projectId: 4 }, { type: 'project.select', projectId: 3 }]);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('include-children').focus()`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'focus leaving project component closes popup');
  assert.equal(await evaluate(`document.activeElement.id`), 'include-children', 'focusout close does not steal focus');
  const outsideBounds = await evaluate(`(()=>{const r=document.getElementById('include-children').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: outsideBounds.x, y: outsideBounds.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: outsideBounds.x, y: outsideBounds.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outsideBounds.x, y: outsideBounds.y, button: 'left', clickCount: 1 });
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'outside mouse click closes popup');
  assert.equal(await evaluate(`document.activeElement.id`), 'include-children', 'outside click does not return focus to trigger');
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('ticket-scroll').dispatchEvent(new Event('scroll',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'external scroll closes popup');
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='tokyo';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('project-search-clear-btn').focus()`);
  await key('Escape');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'Escape closes popup from clear button');
  assert.equal(await evaluate(`document.activeElement.id`), 'project-select-trigger');
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await key('Tab');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'Tab leaving picker closes popup');
  assert.notEqual(await evaluate(`document.activeElement.id`), 'project-select-trigger', 'Tab close does not steal focus');
  await evaluate(`document.getElementById('project-select-trigger').click();window.dispatchEvent(new Event('resize'))`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'resize closes popup');
  assert.equal(await evaluate(`document.getElementById('project-search-input').value`), '');
  await evaluate(`document.getElementById('layout-btn').click()`);
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  assert.equal(await evaluate(`document.getElementById('layout-popover').classList.contains('hidden')`), true, 'opening project picker closes layout popup');
  await evaluate(`document.getElementById('layout-btn').click()`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true, 'opening layout popup closes project picker');
  await evaluate(`document.getElementById('layout-btn').click()`);
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await evaluate(`document.querySelector('#project-listbox [data-project-id="5"]').click()`);
  assert.equal(await evaluate(`window.messages.filter(message=>message.type==='project.select').length`), 2, 'choosing already selected project does not emit project.select');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await evaluate(`document.getElementById('project-search-input').value='plant-n6';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await projectNames(), ['Production', 'Japan', 'Nagoya Plant', 'USA']);
  const messagesBeforeProjectSearchClear = await evaluate(`window.messages.length`);
  await evaluate(`document.getElementById('project-search-clear-btn').click()`);
  assert.equal(await evaluate(`window.messages.length`), messagesBeforeProjectSearchClear, 'clearing project search stays local');
  assert.equal(await evaluate(`document.getElementById('project-search-clear-btn').hidden`), true, 'custom project search clear button hides after clearing');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'clearing keeps popup open');
  assert.deepEqual(await projectNames(), [strings.selectProjectPlaceholder, 'Production', 'Japan', 'Nagoya Plant', 'Tokyo Plant', 'USA', 'Development']);
  const projectsBeforeLongList = state.projects;
  state.projects = [...projectsBeforeLongList, ...Array.from({ length: 28 }, (_value, index) => ({ id: 20 + index, name: `Long project ${index + 1}`, identifier: `long-${index + 1}`, level: 0 }))];
  state.selectedProject = { id: 47, name: 'Long project 28' };
  await push();
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-5', 'valid active candidate survives host state update');
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  state.projects = projectsBeforeLongList;
  state.selectedProject = { id: 5, name: 'USA' };
  await push();
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  state.projects = [...projectsBeforeLongList, ...Array.from({ length: 28 }, (_value, index) => ({ id: 20 + index, name: `Long project ${index + 1}`, identifier: `long-${index + 1}`, level: 0 }))];
  state.selectedProject = { id: 47, name: 'Long project 28' };
  await push();
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-select-trigger').click()`);
  assert.equal(await evaluate(`document.getElementById('project-search-input').getAttribute('aria-activedescendant')`), 'project-option-47');
  assert.equal(await evaluate(`document.getElementById('project-listbox').scrollTop > 0`), true, 'active selected project scrolls into view');
  await evaluate(`document.getElementById('project-listbox').dispatchEvent(new Event('scroll',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false, 'listbox scrolling keeps popup open');
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  state.projects = projectsBeforeLongList;
  state.selectedProject = { id: 5, name: 'USA' };
  await push();
  await evaluate(`document.getElementById('project-select-trigger').click()`);
  await evaluate(`document.getElementById('project-search-input').value='no-such-project';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await projectNames(), ['Production', 'USA']);
  assert.equal(await evaluate(`document.getElementById('project-search-empty').textContent`), strings.noMatchingProjects);
  assert.equal(await evaluate(`document.getElementById('project-search-empty').hidden`), false);
  state.selectedProject = undefined;
  await push();
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), false);
  assert.equal(await evaluate(`document.getElementById('project-search-input').value`), 'no-such-project');
  assert.deepEqual(await projectNames(), []);
  assert.equal(await evaluate(`document.getElementById('project-search-input').hasAttribute('aria-activedescendant')`), false, 'active descendant clears when no direct match remains');
  assert.equal(await evaluate(`document.getElementById('project-select-label').textContent`), strings.selectProjectPlaceholder);
  await evaluate(`document.getElementById('project-search-input').value='tokyo';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await projectNames(), ['Production', 'Japan', 'Tokyo Plant']);
  const priorBaseUrlForProjectSearch = state.settings.baseUrl;
  state.settings.baseUrl = 'https://project-search-switch.example.com';
  await push();
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  assert.equal(await evaluate(`document.getElementById('project-search-input').value`), '');
  assert.deepEqual(await projectNames(), [strings.selectProjectPlaceholder, 'Production', 'Japan', 'Nagoya Plant', 'Tokyo Plant', 'USA', 'Development']);
  state.settings.baseUrl = priorBaseUrlForProjectSearch;
  await push();
  await evaluate(`document.getElementById('tab-settings').click();document.getElementById('project-select-trigger').click();document.getElementById('project-search-input').value='nagoya';document.getElementById('project-search-input').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('settings-connection').open=true;document.getElementById('settings-reset-view-btn').click()`);
  assert.equal(await evaluate(`document.getElementById('project-search-input').value`), '');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  assert.deepEqual(await projectNames(), [strings.selectProjectPlaceholder, 'Production', 'Japan', 'Nagoya Plant', 'Tokyo Plant', 'USA', 'Development']);
  state.projects = originalProjectsForProjectSearch;
  state.selectedProject = originalSelectedProjectForProjectSearch;
  await push();
  await evaluate(`document.getElementById('tab-tickets').click()`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#tabs [role="tab"]')).map(tab=>tab.dataset.tab)`), ['tickets','unsynced','settings']);
  assert.equal(await evaluate(`document.getElementById('tab-comments')`), null);
  assert.equal(await evaluate(`document.getElementById('sync-tray')`), null);
  state.currentUserId = 7;
  state.quickFilterCapabilities = { mine: 'available', open: 'available' };
  state.metadataOptions.statuses = [{ id: 1, name: '進行中', isClosed: false }, { id: 2, name: '完了', isClosed: true }];
  state.tickets[0].assigneeId = 7;
  state.tickets[0].statusId = 1;
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="unsynced"]') === null`), true);
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="editing"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="editing"]').getAttribute('aria-pressed')`), 'false');
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="open"]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('[data-quick-filter="mine"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-quick-filter="mine"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.shownLoadedTickets.replace('{0}','1').replace('{1}','2'));
  await evaluate(`document.querySelector('[data-quick-filter="open"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  await evaluate(`document.querySelector('[data-quick-filter="overdue"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  await evaluate(`document.querySelectorAll('[data-quick-filter][aria-pressed="true"]').forEach(button=>button.click())`);
  await evaluate(`document.getElementById('advanced-filters-btn').click()`);
  assert.equal(await evaluate(`document.activeElement.id`), 'advanced-status');
  await key('Escape');
  assert.equal(await evaluate(`document.activeElement.id`), 'advanced-filters-btn');

  state.unsynced = { totalCount: 1, items: [
    { key: { kind: 'newTicket', queueId: 'failed-create' }, label: 'New ticket', lifecycle: 'queued', canRetrySync: true, canSync: true },
  ] };
  await push();
  assert.ok(await evaluate(`document.querySelector('[data-sync-key]').textContent.includes(${JSON.stringify(strings.retrySync)})`));
  await evaluate(`document.querySelector('[data-sync-key]').click()`);
  const retryMessage = await evaluate(`window.messages.filter(m=>m.type==='unsynced.syncOne').at(-1)`);
  assert.equal(retryMessage.key.queueId, 'failed-create');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:${JSON.stringify(retryMessage.requestId)},message:'OK'}}))`);

  // queued でも Store が remote evidence を検出した項目は破棄不可。
  state.unsynced = { totalCount: 3, items: [
    { key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
    { key: { kind: 'comment', ticketId: 10, commentId: 20 }, label: 'Comment', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
    { key: { kind: 'newTicket', queueId: 'queued-unsafe' }, label: 'New ticket', lifecycle: 'queued', canDiscard: false, discardMode: 'none', canSync: true },
  ] };
  await push();
  await evaluate(`document.getElementById('tab-unsynced').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list .unsynced-actions button:disabled').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-discard-key]').length`), 0);
  const discardCount = await evaluate(`window.messages.filter(m=>m.type==='unsynced.discardOne').length`);
  await evaluate(`document.querySelectorAll('#unsynced-list button:disabled').forEach(button=>button.click())`);
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='unsynced.discardOne').length`), discardCount);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-unsynced-action="sync"].btn-primary').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list .unsynced-more button:disabled[aria-describedby]').length`), 3);
  // 更新しても同じ操作、消えた場合は隣の行にフォーカスを戻す。
  await evaluate(`document.querySelector('[data-sync-key]').focus()`);
  await push();
  assert.equal(await evaluate(`document.activeElement.dataset.unsyncedAction`), 'sync');
  const focusItem=state.unsynced.items.shift(); state.unsynced.totalCount--;
  await push();
  assert.equal(await evaluate(`document.activeElement.dataset.queueKey`), JSON.stringify(state.unsynced.items[0].key));
  state.unsynced.items.unshift(focusItem); state.unsynced.totalCount++;
  await push();
  await evaluate(`const menu=document.querySelector('.unsynced-more');menu.open=true;menu.querySelector('[data-abandon-key]').focus()`);
  await push();
  assert.equal(await evaluate(`document.activeElement.dataset.unsyncedAction`), 'abandon');
  assert.equal(await evaluate(`document.querySelector('.unsynced-more').open`), true);
  await key('Escape');
  assert.equal(await evaluate(`document.activeElement.dataset.unsyncedAction`), 'more');
  assert.equal(await evaluate(`document.querySelector('.unsynced-more').open`), false);
  // nextIntent のみ破棄可能なら同じ queued 表示でも操作が有効になる。
  state.unsynced.items.forEach(item => { item.canDiscard = true; item.discardMode = 'nextIntent'; });
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-discard-key]').length`), 3);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').textContent.trim()`), strings.discardLaterChangesAction);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').getAttribute('title')`), strings.discardLaterChangesTitle);
  await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').click()`);
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'unsynced.discardOne');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:window.messages.at(-1).requestId,message:'キャンセル',level:'info'}}))`);
  state.unsynced = { totalCount: 1, items: [
    { key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', lifecycle: 'queued', canDiscard: true, discardMode: 'active', canSync: true },
  ] };
  await push();
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').textContent.trim()`), strings.discardAction);
  assert.equal(await evaluate(`document.querySelector('#unsynced-list [data-discard-key]').getAttribute('title')`), strings.discardTitle);
  await evaluate(`document.getElementById('toast-area').replaceChildren()`);
  // Extension Host の応答前にも連打・別入口の同期を抑止する。
  await evaluate(`window.messages.length=0;document.querySelector('[data-sync-key]').focus()`);
  await key('Enter');
  await evaluate(`document.querySelector('[data-sync-key]').click();document.getElementById('sync-all-btn').click()`);
  assert.equal(await evaluate(`window.messages.filter(m=>m.type.startsWith('unsynced.sync')).length`), 1);
  const lockedRequest = await evaluate(`window.messages.at(-1).requestId`);
  assert.equal(await evaluate(`document.querySelector('[data-sync-key]').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('[data-abandon-key]').disabled`), true);
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-sync-key]').disabled`), true, 'rerender keeps the request locked');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:${JSON.stringify(lockedRequest)},message:'復旧キャンセル',level:'info'}}))`);
  assert.equal(await evaluate(`document.querySelector('[data-sync-key]').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('#unsynced-feedback').classList.contains('info')`), true);
  assert.equal(await evaluate(`document.querySelectorAll('#toast-area .toast').length`), 0, 'visible inline feedback does not duplicate a toast');
  // 中止済み記録は一括削除を一度だけ要求し、キャンセル後も操作を続けられる。
  assert.equal(await evaluate(`document.getElementById('forget-all-abandoned-btn').classList.contains('hidden')`), true);
  state.unsynced.abandonedItems = [
    { key: { kind: 'ticket', ticketId: 90 }, label: '中止済みチケット', abandonedAt: 1 },
    { key: { kind: 'newTicket', queueId: 'old-new' }, label: '中止済み新規チケット', abandonedAt: 2 },
  ];
  await push();
  assert.equal(await evaluate(`document.getElementById('forget-all-abandoned-btn').classList.contains('hidden')`), false);
  await evaluate(`window.messages.length=0;document.getElementById('forget-all-abandoned-btn').click();document.getElementById('forget-all-abandoned-btn').click()`);
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='unsynced.forgetAllAbandoned').length`), 1);
  assert.equal(await evaluate(`document.getElementById('forget-all-abandoned-btn').disabled`), true);
  const deleteRequest = await evaluate(`window.messages.at(-1).requestId`);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:${JSON.stringify(deleteRequest)},message:'削除キャンセル',level:'info'}}))`);
  assert.equal(await evaluate(`document.getElementById('forget-all-abandoned-btn').disabled`), false);
  state.unsynced.abandonedItems = [];
  await push();
  assert.equal(await evaluate(`document.getElementById('forget-all-abandoned-btn').classList.contains('hidden')`), true);
  state.unsynced.items[0].lifecycle = 'commit_unknown';
  state.unsynced.items[0].requiresReview = true;
  state.unsynced.items[0].canDiscard = false;
  state.unsynced.items[0].discardMode = 'none';
  state.unsynced.items[0].canSync = false;
  await push();
  assert.ok(await evaluate(`document.querySelector('.unsynced-state').textContent.includes(${JSON.stringify(strings.syncOutcomeUnknown)})`));
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'unrelated',message:'完了'}}))`);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list .unsynced-actions button:disabled').length`), 2, 'policy-disabled buttons stay disabled after completion');
  assert.ok(await evaluate(`document.querySelector('.unsynced-state .badge').classList.contains('sync-review')`));
  const queueViewport=await evaluate(`({width:innerWidth,height:innerHeight,theme:document.body.className})`);
  for(const width of [320,440,768]){
    await call('Emulation.setDeviceMetricsOverride', {width,height:800,deviceScaleFactor:1,mobile:false});
    for(const theme of ['vscode-light','vscode-dark']){
      await evaluate(`document.body.className=${JSON.stringify(theme)};document.querySelector('.unsynced-more').open=true;document.getElementById('toast-area').replaceChildren()`);
      await settleViewport();
      assert.equal(await evaluate(`document.querySelector('.unsynced-more-actions').getBoundingClientRect().right <= innerWidth`), true);
      assert.equal(await evaluate(`document.querySelector('[data-unsynced-action="sync"]').getBoundingClientRect().height < 64`), true, 'expanded menu must not stretch the primary action');
      const screenshot=await call('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(directory,'unsynced-'+width+'-'+theme+'.png'),Buffer.from(screenshot.data,'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', {width:queueViewport.width,height:queueViewport.height,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.body.className=${JSON.stringify(queueViewport.theme)};document.getElementById('unsynced-feedback').classList.add('hidden');document.querySelector('.unsynced-more summary').focus()`);

  state.unsynced = { totalCount: 0, items: [] };
  await push();
  assert.equal(await evaluate(`document.activeElement.id`), 'unsynced-list', 'empty queue keeps focus even before result feedback arrives');
  await evaluate(`document.getElementById('tab-tickets').click()`);
  const pendingId = 'a'.repeat(64);
  const pendingFocus = 'b'.repeat(64);
  state.unsynced = { totalCount: 2, items: [], reveal: { sequence: 1, focusIds: [pendingFocus] }, localChanges: [
    { id: pendingId, focusIds: [pendingFocus], label: '未保存の編集', detail: '新規下書き · 親 #89', open: 'editor' },
    { id: 'c'.repeat(64), focusIds: ['d'.repeat(64)], label: 'コメント下書き', detail: '#10', reason: '変更内容を確認できません。' },
  ] };
  await push();
  assert.equal(await evaluate(`document.getElementById('tab-unsynced').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.activeElement.dataset.pendingFocus`), pendingFocus);
  assert.equal(await evaluate(`document.getElementById('unsynced-badge').textContent`), '2');
  assert.equal(await evaluate(`document.getElementById('sync-all-btn').classList.contains('hidden')`), true);
  assert.equal(await evaluate(`document.querySelectorAll('#unsynced-list [data-sync-key], #unsynced-list [data-discard-key]').length`), 0);
  assert.match(await evaluate(`document.getElementById('unsynced-list').textContent`), /親 #89.*変更内容を確認できません/);
  await evaluate(`document.activeElement.querySelector('button').focus();window.messages.length=0`);
  await key('Enter');
  assert.deepEqual(await evaluate(`(({type,itemId})=>({type,itemId}))(window.messages.at(-1))`), { type: 'unsynced.openPendingChange', itemId: pendingId });
  const previewId = 'e'.repeat(64);
  const previewReason = '元のエディターを開けません。読み取り専用で下書きの内容を確認できます。';
  state.unsynced = { totalCount: 4, items: [], localChanges: [
    { id: previewId, focusIds: ['1'.repeat(64)], label: 'チケットの下書き', detail: '#10', reason: previewReason, open: 'preview', canDiscard: true },
    { id: '2'.repeat(64), focusIds: ['3'.repeat(64)], label: '編集中', detail: '#11', open: 'editor', canDiscard: true },
    { id: '4'.repeat(64), focusIds: ['5'.repeat(64)], label: '保護済み', detail: '#12', open: 'preview', canDiscard: false },
    { id: '6'.repeat(64), focusIds: ['7'.repeat(64)], label: '確認不可', detail: '#13', canDiscard: true },
  ] };
  await push();
  for (const width of [440, 280, 768]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await settleViewport();
    const draftCardFits = await evaluate(`(() => {
      const card = document.querySelector('[data-discard-pending-id]').closest('.unsynced-card');
      const message = [...card.querySelectorAll('.unsynced-detail')].find(detail => detail.textContent === ${JSON.stringify(previewReason)});
      const box = card.getBoundingClientRect();
      if (!message) return false;
      const range = document.createRange();
      range.selectNodeContents(message);
      const items = [...range.getClientRects(), ...[...card.querySelectorAll('button')].map(button => button.getBoundingClientRect())];
      return items.every(item => item.left >= box.left && item.right <= box.right && item.top >= box.top && item.bottom <= box.bottom);
    })()`);
    assert.equal(draftCardFits, true, `draft card message and buttons stay within the card at ${width}px`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: queueViewport.width, height: queueViewport.height, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  assert.equal(await evaluate(`document.querySelectorAll('[data-discard-pending-id]').length`), 1);
  assert.equal(await evaluate(`document.querySelector('[data-discard-pending-id]').textContent.trim()`), strings.discardPendingDraft);
  await evaluate(`window.messages.length=0;document.querySelector('[data-discard-pending-id]').focus()`);
  await key('Enter');
  const pendingDiscard = await evaluate(`window.messages.at(-1)`);
  assert.deepEqual(Object.keys(pendingDiscard).sort(), ['itemId', 'requestId', 'type']);
  assert.equal(pendingDiscard.type, 'unsynced.discardPendingChange');
  assert.equal(pendingDiscard.itemId, previewId);
  assert.match(pendingDiscard.requestId, /^req-/);
  assert.equal(await evaluate(`document.querySelector('[data-discard-pending-id]').disabled`), true);
  state.unsynced.localChanges.shift(); state.unsynced.totalCount--;
  await push();
  assert.equal(await evaluate(`document.activeElement.dataset.pendingFocus`), '3'.repeat(64), 'removed draft moves focus to the next card');
  const discardMessage = `チケット #10 の下書きを破棄しました。 https://redmine.example.test/${'ticketdraft'.repeat(12)}`;
  await call('Emulation.setDeviceMetricsOverride', { width: 280, height: 800, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:${JSON.stringify(pendingDiscard.requestId)},message:${JSON.stringify(discardMessage)}}}))`);
  assert.equal(await evaluate(`document.getElementById('unsynced-feedback').textContent`), discardMessage);
  assert.equal(await evaluate(`(() => { const message = document.getElementById('unsynced-feedback'); const bounds = message.getBoundingClientRect(); return message.scrollWidth <= message.clientWidth && bounds.left >= 0 && bounds.right <= innerWidth; })()`), true, 'draft discard feedback wraps within its box');
  await evaluate(`document.getElementById('toast-area').replaceChildren();window.dispatchEvent(new MessageEvent('message',{data:{type:'toast',level:'error',message:${JSON.stringify(discardMessage)}}}))`);
  assert.equal(await evaluate(`(() => { const message = document.querySelector('#toast-area .toast'); const bounds = message.getBoundingClientRect(); return message.scrollWidth <= message.clientWidth && bounds.left >= 0 && bounds.right <= innerWidth; })()`), true, 'draft discard toast wraps within the sidebar');
  await evaluate(`document.getElementById('toast-area').replaceChildren()`);
  await call('Emulation.setDeviceMetricsOverride', { width: queueViewport.width, height: queueViewport.height, deviceScaleFactor: 1, mobile: false });
  await settleViewport();
  state.unsynced = { totalCount: 0, items: [] };
  await push();
  await evaluate(`document.getElementById('tab-tickets').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#search-clear-btn').length`), 1);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).paddingLeft`), '12px');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="11"]')).paddingLeft`), '26px');

  // 属性は Redmine の任意の名前を安全に表示し、未設定時は空バッジを作らない。
  state.tickets[0].trackerName = 'Bug <img src=x onerror=alert(1)>';
  state.tickets[0].priorityName = '優先度 "最優先" & 要確認';
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row[data-id="10"] .ticket-attribute').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="10"]').textContent.includes('Bug <img')`), false);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row img').length`), 0);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.loadedTickets.replace('{0}','2'));
  state.tickets[0].trackerName = 'Bug';
  state.tickets[0].priorityName = 'Normal';

  // 日付は詳細へ集約し、一覧では重複しない。
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row .due-overdue').length`), 0);

  // 一覧に担当者表示や旧表示設定トグルを出さず、詳細ドロワーはコメント専用パネルとして表示する。
  state.selectedTicketId = 10;
  state.tickets[0].assigneeName = 'Taro Yamada';
  state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '担当者表示を確認します。' };
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-assignee').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.detail-metadata-grid, .detail-tabs, .detail-description-section, .detail-description-warning').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('#set-show-assignee,#set-show-tracker,#set-show-priority,#set-show-due-date').length`), 0);

  // 一覧・詳細・コメント・未同期の同じ操作はラベルと SVG が一致する。
  state.comments.ticketId = 10;
  state.comments.items = [{ id: 20, noteIndex: 3, authorName: 'Taro', body: 'Comment', editableByCurrentUser: true, syncKey: { kind: 'comment', ticketId: 10, commentId: 20 } }];
  state.unsynced = { totalCount: 1, items: [{ key: { kind: 'ticket', ticketId: 10 }, label: 'Ticket', documentUri: 'file:///tmp/ticket.md', lifecycle: 'queued' }] };
  await push();
  async function assertSameAction(selectors) {
    const appearances = await evaluate(`(${JSON.stringify(selectors)}).map(selector=>{const button=document.querySelector(selector);return {label:button.textContent.trim(),icon:button.querySelector('svg').outerHTML};})`);
    appearances.slice(1).forEach(actual => assert.deepEqual(actual, appearances[0]));
  }
  assert.equal(await evaluate(`document.querySelector('#detail-sync-btn')`), null);
  assert.equal(await evaluate(`document.querySelector('#detail-browser-btn')`), null);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="10"] [data-ticket-action="sync"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="10"] [data-ticket-action="browser"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="20"] [data-comment-action="sync"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="20"] [data-comment-action="browser"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('#add-comment-btn') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('#sync-all-btn svg').outerHTML`), await evaluate(`document.querySelector('.ticket-row[data-id="10"] [data-ticket-action="sync"] svg').outerHTML`));
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="20"] [data-comment-action="sync"] svg').outerHTML`), await evaluate(`document.querySelector('.ticket-row[data-id="10"] [data-ticket-action="sync"] svg').outerHTML`));
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="20"] [data-comment-action="browser"] svg').outerHTML`), await evaluate(`document.querySelector('.ticket-row[data-id="10"] [data-ticket-action="browser"] svg').outerHTML`));
  // 削除操作は選択中の行ではなく、操作した行の永続 ID と描画時の接続世代を送る。
  state.connectionGeneration = 9;
  state.comments.items.push({ authorName: 'Local draft', body: 'Draft', isLocalUnsynced: true, syncKey: { kind: 'comment', ticketId: 10, documentUri: 'file:///draft.md' } });
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.comment-card:not([data-comment-id]) [data-comment-action="delete"]').length`), 0);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="11"] .ticket-hover-actions')).display`), 'none');
  await evaluate(`document.querySelector('.ticket-row[data-id="11"]').focus();window.messages.length=0`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="11"] .ticket-hover-actions')).display`), 'flex');
  await evaluate(`document.querySelector('.ticket-row[data-id="11"] [data-ticket-action="delete"]').focus()`);
  await key('Enter');
  assert.deepEqual(await evaluate(`(({type,ticketId,connectionGeneration})=>({type,ticketId,connectionGeneration}))(window.messages.at(-1))`), { type: 'deleteTicket', ticketId: 11, connectionGeneration: 9 });
  await evaluate(`window.messages.length=0`);
  const commentPoint = await evaluate(`(()=>{const r=document.querySelector('.comment-card[data-comment-id="20"]').getBoundingClientRect();return {x:r.right-20,y:r.top+10}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...commentPoint });
  const deletePoint = await evaluate(`(()=>{const r=document.querySelector('.comment-card[data-comment-id="20"] [data-comment-action="delete"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...deletePoint, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...deletePoint, button: 'left', buttons: 0, clickCount: 1 });
  assert.deepEqual(await evaluate(`(({type,ticketId,commentId,connectionGeneration})=>({type,ticketId,commentId,connectionGeneration}))(window.messages.at(-1))`), { type: 'deleteComment', ticketId: 10, commentId: 20, connectionGeneration: 9 });
  state.comments.items = [];
  state.unsynced = { totalCount: 0, items: [] };
  await push();
  for (const assigneeName of [undefined, null, '', '   ']) {
    if (assigneeName === undefined) delete state.tickets[0].assigneeName;
    else state.tickets[0].assigneeName = assigneeName;
    state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '未設定の担当者表示を確認します。' };
    await push();
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-assignee').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.detail-avatar').length`), 0);
  }

  // 折りたたみ後の状態更新・子チケット検索・キーボードフォーカス。
  await evaluate(`document.querySelector('[data-expand="10"]').focus()`);
  await key('Enter');
  assert.equal(await evaluate(`document.querySelector('[data-expand="10"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), strings.shownLoadedTickets.replace('{0}','1').replace('{1}','2'));
  assert.equal(await evaluate('window.messages.filter(m=>m.type==="ticket.select").length'), 0);
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-expand="10"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.activeElement.dataset.expand`), '10');
  // 連続入力は最後の値を1回だけ送信。同じプロジェクトの再選択でも予約を失わない。
  await evaluate(`window.messages.length=0;document.getElementById('search-input').value='途中';document.getElementById('search-input').dispatchEvent(new Event('input'));document.getElementById('search-input').value='最後';document.getElementById('search-input').dispatchEvent(new Event('input'));document.getElementById('project-select-trigger').click();document.getElementById('project-option-1').click()`);
  await new Promise(resolve => setTimeout(resolve,350));
  assert.deepEqual(await evaluate(`window.messages.filter(m=>m.type==='tickets.search').map(m=>m.query)`),['最後']);

  // サーバー検索: IME変換中は送信せず、Enterで確定。本文のみの一致を消さない。
  const originalTickets = state.tickets;
  await evaluate(`window.messages.length=0;document.getElementById('search-input').focus();document.getElementById('search-input').dispatchEvent(new CompositionEvent('compositionstart'));document.getElementById('search-input').value='本文だけ';document.getElementById('search-input').dispatchEvent(new Event('input'))`);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='tickets.search').length`), 0);
  await key('Enter');
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='tickets.search').length`), 0);
  await evaluate(`document.getElementById('search-input').dispatchEvent(new CompositionEvent('compositionend'))`);
  await key('Enter');
  assert.deepEqual(await evaluate(`(({query,scope})=>({query,scope}))(window.messages.at(-1))`), { query: '本文だけ', scope: {kind:'project',projectId:1} });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='tickets.search').length`), 1);
  state.ticketSearch = {query:'本文だけ',scope:{kind:'project',projectId:1},includeChildProjects:false};
  state.tickets = [{id:11,subject:'別の件名',level:0,children:[]}];
  state.loadedTicketCount = 1;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-row').dataset.id`), '11');
  // 外部コマンドは検索条件を維持して、モーダルと詳細集中表示から検索欄へ戻す。
  state.selectedTicketId=11;
  state.selectedTicket={...state.tickets[0],projectName:'検証プロジェクト'};
  state.workPanel={mode:'detail',ticketId:11};
  await push();
  const focusSearchFilters = await evaluate(`window.acquireVsCodeApi().getState()?.quickFilters || []`);
  await evaluate(`
    const layoutControl = document.getElementById('ticket-layout-mode');
    layoutControl.value = 'split';
    layoutControl.dispatchEvent(new Event('change'));
    document.getElementById('detail-focus-toggle').click();
    document.getElementById('tab-settings').click();
    document.getElementById('project-select-trigger').click();
    window.messages.length = 0;
  `);
  await focusTicketSearch();
  assert.equal(await evaluate(`document.activeElement.id`), 'search-input');
  assert.equal(await evaluate(`document.getElementById('tab-tickets').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.getElementById('project-picker-popup').hidden`), true);
  assert.equal(await evaluate(`document.getElementById('ticket-detail-card').classList.contains('hidden')`), false);
  assert.deepEqual(await evaluate(`(({detailFocus,ticketLayoutMode,quickFilters})=>({detailFocus,ticketLayoutMode,quickFilters}))(window.acquireVsCodeApi().getState())`), {detailFocus:false,ticketLayoutMode:'split',quickFilters:focusSearchFilters});
  assert.equal(await evaluate(`document.getElementById('search-input').value`), '本文だけ');
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='tickets.search').length`), 0);
  await evaluate(`
    document.getElementById('advanced-filters-btn').click();
    document.getElementById('advanced-unassigned').checked = false;
    window.messages.length = 0;
  `);
  await focusTicketSearch();
  assert.equal(await evaluate(`document.getElementById('advanced-filter-dialog').classList.contains('hidden')`), true);
  assert.equal(await evaluate(`document.activeElement.id`), 'search-input');
  assert.equal(await evaluate(`window.messages.length`), 0);
  await typeText('x');
  await new Promise(resolve => setTimeout(resolve,350));
  assert.deepEqual(await evaluate(`(({query,scope})=>({query,scope}))(window.messages.at(-1))`), {query:'本文だけx',scope:{kind:'project',projectId:1}});
  await evaluate(`document.getElementById('search-input').value='本文だけ';document.getElementById('ticket-layout-mode').value='auto';document.getElementById('ticket-layout-mode').dispatchEvent(new Event('change'))`);
  state.selectedTicketId=undefined; state.selectedTicket=undefined; state.workPanel=undefined;
  await push();
  await evaluate(`document.getElementById('project-select-trigger').click();document.getElementById('project-option-0').click()`);
  assert.deepEqual(await evaluate(`(({type,query})=>({type,query}))(window.messages.at(-1))`), {type:'project.selectAll',query:'本文だけ'});
  state.selectedProject=undefined;
  state.ticketSearch.scope={kind:'all'};
  state.tickets[0].projectName='別プロジェクト';
  await push();
  assert.equal(await evaluate(`document.getElementById('search-input').value`),'本文だけ');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('include-children').closest('label')).display`),'none');
  assert.equal(await evaluate(`document.querySelector('.ticket-project').textContent`),'別プロジェクト');
  await evaluate(`document.getElementById('search-input').focus()`);
  await key('Escape');
  assert.deepEqual(await evaluate(`(({query,scope})=>({query,scope}))(window.messages.at(-1))`),{query:'',scope:{kind:'all'}});
  state.selectedProject={id:1,name:'検証プロジェクト'};
  state.ticketSearch={query:'',scope:{kind:'project',projectId:1},includeChildProjects:false};
  state.tickets=originalTickets;
  state.loadedTicketCount=2;
  await push();
  // 行から詳細を開く操作とフォーカスを維持する。
  await evaluate(`document.querySelector('.ticket-row[data-id="10"]').focus()`);
  await key('Enter');
  assert.equal(await evaluate(`window.messages.at(-1).type`),'ticket.select');
  assert.equal(await evaluate(`window.messages.at(-1).ticketId`),10);

  // Detail の主要操作は既存 request のまま。コメント専用パネルと安全なコメント表示を確認する。
  state.selectedProject = { id: 1, name: '検証プロジェクト' };
  state.selectedTicketId = 10;
  state.selectedTicket = { id: 10, subject: '詳細操作の検証', projectName: '検証プロジェクト', trackerName: 'Bug', priorityName: 'Normal', statusName: 'Open', assigneeName: 'Taro', startDate: '2026-09-21', dueDate: '2026-09-30', syncState: 'Synced', description: '<img src=x onerror=alert(1)>\nRedmine の説明\n3行目\n4行目' };
  state.editOptions = { ticketId: 10, projectId: 1, loading: false, statusFallback: false, trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Task' }], priorities: [{ id: 1, name: 'Normal' }, { id: 2, name: 'High' }], statuses: [{ id: 1, name: 'Open' }, { id: 2, name: 'Closed' }], assignees: [{ id: 1, name: 'Taro' }] };
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('#ticket-detail-card .detail-tabs, #detail-tab-overview, #detail-tab-comments, .detail-metadata-grid, .detail-description, .detail-description-warning').length`), 0);
  assert.equal(await evaluate(`document.querySelector('#ticket-detail-card .detail-header-fixed') !== null && document.querySelectorAll('#ticket-detail-card .detail-subject, #ticket-detail-card .detail-project-name, #ticket-detail-card .detail-head-row2').length === 0`), true);
  assert.equal(await evaluate(`document.getElementById('detail-comments').hidden`), false);
  assert.equal(await evaluate(`document.getElementById('detail-comment-count').textContent`), '0');
  state.tickets[0].syncState = 'Queued';
  await push();
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="10"]').getAttribute('aria-current')`), 'true');
  assert.equal(await evaluate(`document.querySelectorAll('#ticket-detail-card textarea, #comments-list img, #comments-list [contenteditable]').length`), 0);
  state.comments.ticketId = 10;
  state.comments.items = [{ id: 31, authorName: 'Taro', body: '1行目\n2行目\n3行目\n4行目', editableByCurrentUser: true }];
  await push();
  assert.equal(await evaluate(`document.getElementById('detail-comment-count').textContent`), '1');
  assert.equal(await evaluate(`document.querySelector('.comment-body').textContent`), state.comments.items[0].body);
  assert.equal(await evaluate(`document.querySelector('.comment-timeline') !== null`), true);
  await evaluate(`document.querySelector('.comment-card.is-editable').click()`);
  assert.deepEqual(await evaluate(`({type:window.messages.at(-1).type,ticketId:window.messages.at(-1).ticketId,commentId:window.messages.at(-1).commentId})`), { type: 'comment.edit', ticketId: 10, commentId: 31 });
  state.comments.items = [
    { id: 31, authorName: 'Taro', body: Array.from({ length: 12 }, (_, i) => `長文行${i + 1}`).join('\n'), editableByCurrentUser: true },
    { id: 32, authorName: 'Hanako', body: '短いコメント', editableByCurrentUser: false },
  ];
  await push();
  const commentLayout = await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('#comments-list .comment-card'));
    const longBody = cards[0].querySelector('.comment-body');
    const shortBody = cards[1].querySelector('.comment-body');
    longBody.scrollTop = 20;
    return {
      longCardHeight: cards[0].getBoundingClientRect().height,
      shortCardHeight: cards[1].getBoundingClientRect().height,
      longScrollable: longBody.scrollHeight > longBody.clientHeight,
      longOverflowY: getComputedStyle(longBody).overflowY,
      longScrollTop: longBody.scrollTop,
      shortOverflowY: getComputedStyle(shortBody).overflowY,
      shortScrollable: shortBody.scrollHeight > shortBody.clientHeight,
    };
  })()`);
  assert.equal(commentLayout.longCardHeight, 80);
  assert.equal(commentLayout.shortCardHeight, 80);
  assert.equal(commentLayout.longScrollable, true);
  assert.equal(commentLayout.longOverflowY, 'auto');
  assert.ok(commentLayout.longScrollTop > 0);
  assert.equal(commentLayout.shortOverflowY, 'auto');
  assert.equal(commentLayout.shortScrollable, false);
  for (const [selector, type] of [['#add-comment-btn', 'comment.add'], ['#reload-comments-btn', 'comment.reload'], ['.ticket-row[data-id="10"] [data-ticket-action="browser"]', 'ticket.openBrowser']]) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    assert.deepEqual(await evaluate(`({type:window.messages.at(-1).type,ticketId:window.messages.at(-1).ticketId})`), { type, ticketId: 10 });
  }
  state.comments.items = [
    { id: 31, noteIndex: 1, authorName: 'Taro', body: '編集中のコメント', editableByCurrentUser: true, isEditing: true, hasUnsyncedEdit: false },
    { id: 32, noteIndex: 2, authorName: 'Hanako', body: '未同期編集のコメント', editableByCurrentUser: true, isEditing: false, hasUnsyncedEdit: true },
    { authorName: 'Local draft', body: 'ローカル下書きコメント', editableByCurrentUser: false, hasUnsyncedEdit: true, isLocalUnsynced: true, syncKey: { kind: 'comment', ticketId: 10, documentUri: 'file:///tmp/comment-draft.md' } },
  ];
  state.comments.selectedCommentId = 32;
  state.comments.selectedCommentUri = undefined;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('#comments-list .comment-card .unsynced-inline-badge')[0]?.textContent`), strings.syncEditing);
  assert.equal(await evaluate(`document.querySelectorAll('#comments-list .comment-card .unsynced-inline-badge')[1]?.textContent`), strings.unsyncedEditBadge);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="31"]').classList.contains('selected')`), false);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="31"]').getAttribute('aria-current')`), 'false');
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="32"]').classList.contains('selected')`), true);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="32"]').getAttribute('aria-current')`), 'true');
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-uri="file:///tmp/comment-draft.md"] [data-comment-action="sync"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-uri="file:///tmp/comment-draft.md"] [data-comment-action="browser"]')`), null);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.comment-card[data-comment-id="32"] .comment-hover-actions')).display`), 'none');
  await evaluate(`document.querySelector('.comment-card[data-comment-id="32"]').focus()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.comment-card[data-comment-id="32"] .comment-hover-actions')).display`), 'flex');
  await evaluate(`document.querySelector('.comment-card[data-comment-id="32"]').blur()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.comment-card[data-comment-id="32"] .comment-hover-actions')).display`), 'none');
  await evaluate(`window.messages.length=0;document.querySelector('.comment-card[data-comment-id="32"] [data-comment-action="sync"]').click()`);
  assert.deepEqual(await evaluate(`window.messages.map(m=>({type:m.type,ticketId:m.ticketId,commentId:m.commentId}))`), [{ type: 'comment.syncSelected', ticketId: 10, commentId: 32 }]);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="32"] [data-comment-action="sync"]').disabled`), true);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:window.messages.at(-1).requestId,message:'同期しました'}}))`);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-id="32"] [data-comment-action="sync"]').disabled`), false);
  await evaluate(`window.messages.length=0;document.querySelector('.comment-card[data-comment-id="32"] [data-comment-action="browser"]').click()`);
  assert.deepEqual(await evaluate(`window.messages.map(m=>({type:m.type,ticketId:m.ticketId,commentId:m.commentId,noteIndex:m.noteIndex}))`), [{ type: 'comment.openBrowser', ticketId: 10, commentId: 32, noteIndex: 2 }]);
  await evaluate(`window.messages.length=0;document.querySelector('.comment-card[data-comment-uri="file:///tmp/comment-draft.md"] [data-comment-action="sync"]').click()`);
  assert.deepEqual(await evaluate(`window.messages.map(m=>({type:m.type,ticketId:m.ticketId,documentUri:m.documentUri}))`), [{ type: 'comment.syncSelected', ticketId: 10, documentUri: 'file:///tmp/comment-draft.md' }]);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:window.messages.at(-1).requestId,message:'同期しました'}}))`);
  state.comments.selectedCommentId = undefined;
  state.comments.selectedCommentUri = 'file:///tmp/comment-draft.md';
  await push();
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-uri="file:///tmp/comment-draft.md"]').classList.contains('selected')`), true);
  assert.equal(await evaluate(`document.querySelector('.comment-card[data-comment-uri="file:///tmp/comment-draft.md"]').getAttribute('aria-current')`), 'true');
  state.comments.selectedCommentUri = undefined;
  state.comments.items = [];
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('[data-ticket-action-menu="detail-10"]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-ticket-action="refresh"]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-metadata-field]').length`), 0);

  // Escape キーで詳細ドロワーを閉じる。
  await evaluate(`document.querySelector('.ticket-row[data-id="10"]').focus()`);
  await key('Escape');
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'ticket.cancelDetail');

  // 同期は送信直後から無効化し、state 更新・started・成功・失敗でも二重送信しない。
  const rowSyncSelector = '.ticket-row[data-id="10"] [data-ticket-action="sync"]';
  const beforeSync = await evaluate('window.messages.length');
  await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).click();document.querySelector(${JSON.stringify(rowSyncSelector)}).click()`);
  assert.equal(await evaluate('window.messages.length'), beforeSync + 1);
  const syncRequest = await evaluate('window.messages.at(-1)');
  assert.equal(syncRequest.type, 'ticket.syncSelected');
  assert.equal(syncRequest.ticketId, 10);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), true);
  await push();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), true);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.started',requestId:'${syncRequest.requestId}',label:'同期中…'}}))`);
  state.selectedTicket.syncState = 'Synced';
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'${syncRequest.requestId}',message:'同期が完了しました'}}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), false);
  assert.equal(await evaluate(`document.querySelector('.toast-success:last-child').textContent`), '同期が完了しました');
  await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).click()`);
  const failedSync = await evaluate('window.messages.at(-1).requestId');
  state.selectedTicket.syncState = 'Failed';
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.error',requestId:'${failedSync}',message:'同期に失敗しました'}}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), false);
  assert.equal(await evaluate(`document.querySelector('.toast-error:last-child').textContent`), '同期に失敗しました');
  // キャッシュ再取得の中断通知も started を終了し、同期操作を再び使えるようにする。
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.started',requestId:'interrupted-cache-reset',label:'キャッシュ再取得中'}}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), true);
  await push();
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:'interrupted-cache-reset',message:'表示が変更されたため再取得を中断しました',level:'info'}}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), false);
  const messagesAfterReset = await evaluate('window.messages.length');
  await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).click()`);
  assert.equal(await evaluate('window.messages.length'), messagesAfterReset + 1);
  assert.equal(await evaluate('window.messages.at(-1).type'), 'ticket.syncSelected');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'operation.success',requestId:window.messages.at(-1).requestId,message:'完了'}}))`);
  for (const [syncState, label] of [['Synced', ''], ['Draft', strings.draft], ['Dirty', strings.syncEditing], ['Queued', strings.syncQueued], ['Syncing', strings.syncSyncing], ['Failed', strings.syncFailed], ['Conflict', strings.syncConflict], ['RecoveryPending', strings.syncRecoveryPending], ['CommitUnknown', strings.syncOutcomeUnknown]]) {
    state.selectedTicket.syncState = syncState;
    if (syncState === 'Dirty' || syncState === 'Queued' || syncState === 'Synced') {
      state.tickets[0].syncState = syncState;
    }
    await push();
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSyncSelector)}).disabled`), syncState === 'Syncing');
    if (syncState === 'Dirty' || syncState === 'Queued') {
      assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="${state.tickets[0].id}"] .unsynced-inline-badge')?.textContent`), label);
    } else if (syncState === 'Synced') {
      assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="${state.tickets[0].id}"] .unsynced-inline-badge')`), null);
    }
  }

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

  // 狭幅でも詳細カードがはみ出さず、テーマの境界とフォーカスが残る。
  for (const [theme, width] of [['vscode-light', 280], ['vscode-dark', 320], ['vscode-dark', 440], ['vscode-light', 768], ['vscode-high-contrast', 320]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(theme)}`);
    await push();
    assert.equal(await evaluate(`document.getElementById('ticket-detail-card').scrollWidth <= document.getElementById('ticket-detail-card').clientWidth`), true, `detail overflow: ${theme} ${width}`);
    assert.equal(await evaluate(`(()=>{const card=document.getElementById('ticket-detail-card').getBoundingClientRect();return [...document.querySelectorAll('#detail-cancel-btn, #add-comment-btn, #reload-comments-btn')].filter(el=>el.getClientRects().length>0).every(el=>{const r=el.getBoundingClientRect();return r.left>=card.left && r.right<=card.right;});})()`), true, `control overflow: ${theme} ${width}`);
    await evaluate(`document.querySelector('.ticket-row[data-id="10"]').focus()`);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).outlineStyle`), 'none');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]'),'::before').content`), 'none');
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).backgroundColor`), 'rgba(0, 0, 0, 0)');
    assert.notEqual(
      await evaluate(`getComputedStyle(document.querySelector('.ticket-row[data-id="10"]')).backgroundColor`),
      await evaluate(`getComputedStyle(document.getElementById('ticket-scroll')).backgroundColor`),
      `selected ticket highlight differs from scroll background: ${theme} ${width}`,
    );
  }

  // 新規作成パネルが詳細列に収まり、更新中も入力値と選択範囲を保持する。
  await evaluate(`document.getElementById('tab-tickets').click()`);
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
  const beforeComposerSearch = structuredClone(state);
  for (const mode of ['newTicket', 'childTicket']) {
    state.workPanel = { ...beforeComposerSearch.workPanel, mode, parentTicketId: 10, parentSubject: 'Parent' };
    await push();
    await evaluate(`document.getElementById('work-description').value='検索しても保持する本文';document.getElementById('work-description').dispatchEvent(new Event('input'));document.getElementById('work-due-date').value='2026-10-31';document.getElementById('work-due-date').dispatchEvent(new Event('input'))`);
    await evaluate(`document.getElementById('search-input').value='検索';document.getElementById('search-input').focus()`);
    await key('Enter');
    assert.equal(await evaluate('window.messages.at(-1).type'), 'tickets.search');
    state.selectedTicketId = undefined;
    state.selectedTicket = undefined;
    state.ticketSearch = { query: '検索', scope: { kind: 'project', projectId: 1 }, includeChildProjects: false };
    for (const phase of ['loading', 'empty', 'error', 'clear']) {
      state.loading.tickets = phase === 'loading';
      state.errors.tickets = phase === 'error' ? '検索失敗' : undefined;
      state.tickets = [];
      if (phase === 'clear') {
        await evaluate(`document.getElementById('search-input').value=''`);
        await key('Enter');
        state.ticketSearch.query = '';
      }
      await push();
      assert.equal(await evaluate(`document.getElementById('work-description').value`), '検索しても保持する本文', `${mode} ${phase}`);
      assert.equal(await evaluate(`document.getElementById('work-due-date').value`), '2026-10-31');
      assert.equal(await evaluate(`document.getElementById('work-tracker').value`), 'バグ');
      assert.equal(await evaluate(`document.getElementById('work-sync-new-ticket').disabled`), false, 'draftUriを保持');
      assert.equal(await evaluate('document.activeElement.id'), 'search-input');
    }
  }
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, beforeComposerSearch);
  await push();
  await evaluate(`document.getElementById('work-description').focus()`);
  delete state.workPanel;
  await push();

  // プロジェクト未選択でもエラーが案内に隠れず、再試行が既存 protocol を使う。
  state.selectedProject = undefined;
  state.tickets = [];
  state.errors.tickets = '接続に失敗しました';
  await push();
  assert.equal(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('接続に失敗しました')`), true);
  assert.equal(await evaluate(`document.getElementById('ticket-count').textContent`), '');
  await evaluate(`document.getElementById('retry-tickets').click()`);
  assert.equal(await evaluate('window.messages.at(-1).type'), 'tickets.search');
  state.errors = {};
  state.loading.tickets = true;
  await push();
  assert.equal(await evaluate(`document.getElementById('ticket-list').getAttribute('aria-busy')`), 'true');
  assert.equal(await evaluate(`document.querySelector('.loading-state').textContent`), strings.loadingTickets);
  state.loading.tickets = false;
  await push();
  assert.equal(await evaluate(`document.getElementById('project-select-label').textContent`), strings.selectProjectPlaceholder);

  // Settings の主要セクション、編集可能なコントロール、キーボード到達性を検証。
  await evaluate(`document.getElementById('tab-settings').click()`);
  const settingSections = await evaluate(`[...document.querySelectorAll('#settings-content .settings-category > summary')].map(node=>node.textContent)`);
  assert.equal(settingSections.includes(strings.sectionConnection), true);
  assert.equal(settingSections.includes(strings.sectionTickets), true);
  assert.equal(settingSections.includes(strings.sectionSync), true);
  assert.equal(settingSections.includes(strings.sectionEditor), true);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#settings-content [data-section]')].map(node=>node.dataset.section)`), ['tickets','ticket-filter','sort','due-date','sync','editor','connection','maintenance']);
  for (const id of ['set-base-url', 'set-default-project', 'set-request-timeout', 'set-ignore-ssl', 'set-ticket-limit', 'set-editor-storage', 'set-editor-subject']) {
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}) !== null`), true, `missing setting control: ${id}`);
  }
  for (const [field, label] of [['dueDate', strings.dueDateLabel], ['startDate', strings.startDate]]) {
    assert.equal(await evaluate(`document.querySelector('#set-sort-field option[value="${field}"]').textContent`), label);
    await evaluate(`document.getElementById('set-sort-field').value='${field}';document.getElementById('set-sort-field').dispatchEvent(new Event('change'))`);
    assert.equal(await evaluate('window.messages.at(-1).patch.sort.field'), field);
    state.settings.sort.field = field;
    await push();
    for (const direction of ['asc', 'desc']) {
      await evaluate(`document.getElementById('set-sort-dir').value='${direction}';document.getElementById('set-sort-dir').dispatchEvent(new Event('change'))`);
      assert.equal(await evaluate('window.messages.at(-1).patch.sort.direction'), direction);
      assert.equal(await evaluate('window.messages.at(-1).patch.sort.field'), field);
      state.settings.sort.direction = direction;
      await push();
    }
  }
  // 未編集のフォーカス値はホストの更新に従い、編集中の値は同じ接続先で維持する。
  const previousBaseUrl = state.settings.baseUrl;
  const previousDefaultProjectId = state.settings.defaultProjectId;
  state.settings.baseUrl = 'https://first.example.com';
  await push();
  await evaluate(`document.getElementById('settings-connection').open=true;document.getElementById('set-base-url').focus()`);
  state.settings.baseUrl = 'https://second.example.com';
  await push();
  assert.equal(await evaluate(`document.getElementById('set-base-url').value`), state.settings.baseUrl);
  assert.equal(await evaluate(`document.activeElement.id`), 'set-base-url');
  state.settings.defaultProjectId = 'first';
  await push();
  await evaluate(`document.getElementById('set-default-project').focus()`);
  state.settings.defaultProjectId = 'second';
  await push();
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'second');
  await evaluate(`document.getElementById('set-default-project').value='local draft';document.getElementById('set-default-project').dispatchEvent(new Event('input'))`);
  state.settings.ticketListLimit += 1;
  await push();
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'local draft');
  assert.equal(await evaluate(`document.activeElement.id`), 'set-default-project');
  state.settings.baseUrl = 'https://third.example.com';
  state.settings.defaultProjectId = 'third';
  await push();
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'third');
  state.settings.baseUrl = previousBaseUrl;
  state.settings.defaultProjectId = previousDefaultProjectId;
  state.settings.ticketListLimit -= 1;
  await push();
  await evaluate(`document.getElementById('settings-connection').open=true; document.getElementById('set-base-url').focus(); document.getElementById('set-base-url').value='https://redmine.example.com'; document.getElementById('set-base-url').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate('window.messages.at(-1).type'), 'settings.updateConnection');
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.id'), 'set-default-project');

  // 実キー入力中に接続が変わっても、旧フォームの change を新接続へ送らない。
  state.settings.baseUrl = 'https://settings-a.example.com';
  state.settings.defaultProjectId = 'project-a';
  await push();
  await evaluate(`window.messages=[];document.getElementById('set-default-project').focus();document.getElementById('set-default-project').select()`);
  await typeText('draft-in-a');
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'draft-in-a');
  state.settings.baseUrl = 'https://settings-b.example.com';
  state.settings.defaultProjectId = 'project-b';
  await push();
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').length`), 0);
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'project-b');

  await evaluate(`window.messages=[];document.getElementById('set-base-url').focus();document.getElementById('set-base-url').select()`);
  await typeText('https://draft-in-b.example.com');
  assert.equal(await evaluate(`document.getElementById('set-base-url').value`), 'https://draft-in-b.example.com');
  state.settings.baseUrl = 'https://settings-c.example.com';
  await push();
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').length`), 0);
  assert.equal(await evaluate(`document.getElementById('set-base-url').value`), state.settings.baseUrl);

  // 同一接続の背景再描画では未確定値を保持し、その後の Tab で一度だけ保存する。
  await evaluate(`window.messages=[];document.getElementById('set-default-project').focus();document.getElementById('set-default-project').select()`);
  await typeText('local-draft');
  state.settings.ticketListLimit += 1;
  await push();
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'local-draft');
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').length`), 0);
  await key('Tab');
  assert.deepEqual(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').map(m=>m.patch)`), [{ defaultProjectId: 'local-draft' }]);

  // 確定後はホストが trim した値へ追従する。
  await evaluate(`window.messages=[];document.getElementById('set-default-project').focus();document.getElementById('set-default-project').select()`);
  await typeText('  normalized-project  ');
  await key('Enter');
  assert.deepEqual(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').map(m=>m.patch)`), [{ defaultProjectId: '  normalized-project  ' }]);
  state.settings.defaultProjectId = 'normalized-project';
  await push();
  assert.equal(await evaluate(`document.getElementById('set-default-project').value`), 'normalized-project');
  assert.equal(await evaluate(`window.messages.filter(m=>m.type==='settings.updateConnection').length`), 1);
  state.settings.baseUrl = previousBaseUrl;
  state.settings.defaultProjectId = previousDefaultProjectId;
  state.settings.ticketListLimit -= 1;
  await push();

  // 接続設定以外も実入力、背景再描画、接続切替、ホスト確定値を同じ操作列で検証する。
  const settingInputs = [
    { id: 'set-ticket-limit', type: 'settings.updateGeneral', initial: 50, values: ['75', '76', '77'], host: value => { state.settings.ticketListLimit = Number(value); }, payload: value => ({ patch: { ticketListLimit: Number(value) } }) },
    { id: 'set-editor-storage', type: 'settings.updateEditor', initial: '', values: ['normal-storage', 'redrawn-storage', 'stale-storage'], host: value => { state.settings.editorStorageDirectory = value; }, payload: value => ({ patch: { editorStorageDirectory: value } }) },
    ...['subject', 'description', 'tracker', 'priority', 'status'].map(field => ({
      id: `set-editor-${field}`, type: 'settings.updateEditorDefault', initial: '',
      values: [`normal-${field}`, `redrawn-${field}`, `stale-${field}`],
      host: value => { state.settings.editorDefaults[field] = value; },
      payload: value => ({ field, value }),
    })),
  ];
  const formBaseUrl = 'https://settings-form.example.com';
  const editSetting = async (entry, value) => {
    await evaluate(`{document.getElementById('settings-editor').open=true;document.getElementById('settings-tickets').open=true;const input=document.getElementById(${JSON.stringify(entry.id)});input.focus();${entry.id === 'set-ticket-limit' ? "input.value=''" : 'input.select()'}}`);
    await typeText(value);
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(entry.id)}).value`), value, entry.id);
  };
  const settingRequests = async type => evaluate(`window.messages.filter(message=>message.type===${JSON.stringify(type)}).map(message=>({type:message.type,patch:message.patch,field:message.field,value:message.value}))`);
  for (const entry of settingInputs) {
    state.settings.baseUrl = formBaseUrl;
    entry.host(entry.initial);
    await push();
    await evaluate('window.messages=[]');
    await editSetting(entry, entry.values[0]);
    await key('Tab');
    assert.deepEqual(await settingRequests(entry.type), [{ type: entry.type, ...entry.payload(entry.values[0]) }], `${entry.id}: normal Tab`);

    entry.host(entry.values[0]);
    await push();
    await evaluate('window.messages=[]');
    await editSetting(entry, entry.values[1]);
    state.settings.showStatus = !state.settings.showStatus;
    await push();
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(entry.id)}).value`), entry.values[1], `${entry.id}: redraw value`);
    assert.equal((await settingRequests(entry.type)).length, 0, `${entry.id}: before Tab`);
    await key('Tab');
    assert.deepEqual(await settingRequests(entry.type), [{ type: entry.type, ...entry.payload(entry.values[1]) }], `${entry.id}: redraw Tab`);

    entry.host(entry.values[1]);
    state.settings.baseUrl = 'https://settings-before-switch.example.com';
    await push();
    await evaluate('window.messages=[]');
    await editSetting(entry, entry.values[2]);
    state.settings.baseUrl = 'https://settings-after-switch.example.com';
    entry.host(entry.initial);
    await push();
    assert.equal((await settingRequests(entry.type)).length, 0, `${entry.id}: old form after switch`);
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(entry.id)}).value`), String(entry.initial), `${entry.id}: new connection value`);
  }

  state.settings.baseUrl = formBaseUrl;
  state.settings.editorDefaults.subject = '';
  await push();
  await evaluate('window.messages=[]');
  await editSetting(settingInputs[2], '  normalized-subject  ');
  await key('Enter');
  assert.deepEqual(await settingRequests('settings.updateEditorDefault'), [{ type: 'settings.updateEditorDefault', field: 'subject', value: '  normalized-subject  ' }]);
  state.settings.editorDefaults.subject = 'normalized-subject';
  await push();
  assert.equal(await evaluate(`document.getElementById('set-editor-subject').value`), 'normalized-subject');
  assert.equal((await settingRequests('settings.updateEditorDefault')).length, 1);
  state.settings.baseUrl = previousBaseUrl;
  state.settings.showStatus = true;
  state.settings.editorDefaults.subject = '';
  await push();

  // 日本語・テーマ・320/480/768/1200px で設定の横はみ出しを検証。
  for (const width of [320, 480, 768, 1200]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.getElementById('tab-settings').click()`);
    assert.equal(await evaluate(`document.getElementById('settings-panel').scrollWidth <= document.getElementById('settings-panel').clientWidth`), true, `settings overflow at ${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `page overflow at ${width}`);
  }
  state.selectedProject = { id: 1, name: '検証プロジェクト' };
  state.tickets = Array.from({ length: 20 }, (_, index) => ({ id: 10 + index, subject: 'チケットの詳細と操作を確認するための長い件名 ' + index, level: 0, trackerName: '長い名前のカスタムトラッカー', priorityName: 'カスタム優先度・最優先', statusName: '進行中', syncState: 'Queued', dueDate: '2020-01-01', children: [] }));
  state.loadedTicketCount = state.tickets.length;
  state.totalTicketCount = state.tickets.length;
  await evaluate(`document.getElementById('toast-area').replaceChildren()`);
  state.selectedTicketId = 10;
  state.selectedTicket = { ...state.tickets[0], projectName: '検証プロジェクト', description: '日本語の説明文と状態表示を確認します。\nキーボードと画面幅に合わせて操作できます。' };
  for (const [theme, width] of [['vscode-light', 280], ['vscode-light', 320], ['vscode-dark', 440], ['vscode-dark', 768], ['vscode-dark', 1200], ['vscode-high-contrast-light', 480], ['vscode-high-contrast', 320]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.className=${JSON.stringify(theme)};document.getElementById('tab-tickets').click()`);
    await push();
    if (theme === 'vscode-dark') assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(37, 37, 38)');
    if (theme === 'vscode-light' || theme === 'vscode-dark') {
      assert.notEqual(
        await evaluate(`getComputedStyle(document.getElementById('ticket-detail-card')).backgroundColor`),
        await evaluate(`getComputedStyle(document.getElementById('ticket-scroll')).backgroundColor`),
        `detail background differs from list: ${theme} ${width}`,
      );
    }
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-row .due-overdue').length`), 0);
    assert.equal(await evaluate(`document.querySelector('.tickets-master').scrollWidth <= document.querySelector('.tickets-master').clientWidth`), true);
    assert.equal(await evaluate(`document.getElementById('ticket-scroll').scrollWidth <= document.getElementById('ticket-scroll').clientWidth`), true, `list overflow: ${theme} ${width}`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-master')).borderRightWidth`), '1px');
    assert.equal(await evaluate(`document.querySelector('.ticket-subject').getBoundingClientRect().width >= 40`), true, `subject clipped: ${theme} ${width}`);
    assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.selected .ticket-hover-actions svg[aria-hidden="true"]').length === 3`), true);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row:not(.selected) .ticket-hover-actions')).display`), 'none');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row.selected .ticket-hover-actions')).display`), 'none');
    await evaluate(`document.querySelector('.ticket-row.selected').focus()`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row.selected .ticket-hover-actions')).display`), 'flex');
    await evaluate(`document.querySelector('.ticket-row.selected').blur()`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ticket-row.selected .ticket-hover-actions')).display`), 'none');
    if (width < 700) assert.equal(await evaluate(`document.querySelector('.tickets-master').getBoundingClientRect().height <= innerHeight * .55 + 1`), true);
    await evaluate(`document.getElementById('ticket-scroll').scrollTop=0; document.querySelector('.tickets-layout').scrollTop=0`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(directory, `${theme}-${width}.png`), Buffer.from(data, 'base64'));
  }
  // 長い名前を表示したまま、125% / 200% 拡大時の操作起点とキーボード操作を確認する。
  const previousProjectName = state.selectedProject.name;
  state.selectedProject.name = '長いプロジェクト名'.repeat(12);
  state.projects[0].name = state.selectedProject.name;
  await call('Emulation.setDeviceMetricsOverride', { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const zoom of [1.25, 2]) {
    await evaluate(`document.documentElement.style.zoom=${JSON.stringify(String(zoom))}`);
    await push();
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `page overflow at ${zoom}x`);
    assert.equal(await evaluate(`document.getElementById('include-children').getBoundingClientRect().right <= innerWidth`), true, `include children clipped at ${zoom}x`);
    assert.equal(await evaluate(`document.querySelector('.ticket-subject').getBoundingClientRect().width > 0`), true, `subject clipped at ${zoom}x`);
    await evaluate(`document.getElementById('layout-btn').focus()`);
    await key('Enter');
    assert.equal(await evaluate(`document.getElementById('layout-btn').getAttribute('aria-expanded')`), 'true');
    await key('Escape');
    assert.equal(await evaluate(`document.getElementById('layout-btn').getAttribute('aria-expanded')`), 'false');
  }
  await evaluate(`document.documentElement.style.zoom=''`);
  state.selectedProject.name = previousProjectName;
  state.projects[0].name = previousProjectName;

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
  await evaluate(`document.querySelector('.tickets-layout').scrollTop=0; document.getElementById('ticket-scroll').scrollTop=0`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.ticket-subject')).fontSize)`), 13);
  await evaluate(`document.documentElement.style.setProperty('--vscode-font-size','16px')`);
  assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.ticket-subject')).fontSize)`), 16);
  await evaluate(`document.documentElement.style.removeProperty('--vscode-font-size');document.getElementById('detail-focus-toggle').click()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-master')).display`), 'none');
  assert.equal(await evaluate(`window.acquireVsCodeApi().getState().detailFocus`), true);
  await push();
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tickets-master')).display`), 'none');
  await evaluate(`document.getElementById('detail-focus-toggle').click()`);
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.tickets-master')).display`), 'none');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'toast',level:'info',message:'位置確認'}}))`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`document.getElementById('toast-area').getBoundingClientRect().bottom <= window.innerHeight`), true);
  await evaluate(`document.getElementById('toast-area').replaceChildren()`);
  const preview = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(directory, 'dashboard-preview.png'), Buffer.from(preview.data, 'base64'));
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate('window.cspViolations'), [], 'Dashboard は CSP 違反を発生させない');

  // 再構築 UI: view.toggleCompactMode・総件数バッジ・高優先度フィルタ・キーボード操作
  assert.equal(await evaluate(`document.getElementById('tickets-badge').textContent`), '5');
  assert.equal(await evaluate(`document.getElementById('ticket-list').classList.contains('is-compact')`), false);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'view.toggleCompactMode'}}))`);
  assert.equal(await evaluate(`document.getElementById('ticket-list').classList.contains('is-compact')`), true);
  assert.equal(await evaluate(`window.acquireVsCodeApi().getState().compactMode`), true);
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'view.toggleCompactMode'}}))`);
  assert.equal(await evaluate(`document.getElementById('ticket-list').classList.contains('is-compact')`), false);
  await evaluate(`document.querySelector('[data-quick-filter="high"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 2);
  await evaluate(`document.querySelector('[data-quick-filter="high"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 5);
  await evaluate(`document.querySelector('.ticket-row[data-id="2816"]').focus()`);
  await key('ArrowDown');
  assert.equal(await evaluate(`document.activeElement.dataset.id`), '2815');
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'ticket.select');
  assert.equal(await evaluate(`window.messages.at(-1).preserveFocus`), true);
  await key('ArrowUp');
  assert.equal(await evaluate(`document.activeElement.dataset.id`), '2816');
  assert.equal(await evaluate(`window.messages.at(-1).preserveFocus`), true);

  // #NEW 下書き行、フィルタ親自動展開・終了除外

  state.draftTickets = [{
    queueId: 'draft-q1',
    documentUri: 'file:///tmp/redmine-client-new-ticket-draft-1.md',
    subject: '下書きテスト件名',
    projectId: 1,
    trackerName: 'Bug',
    statusName: '新規',
    priorityName: 'High',
    dueDate: '2020-01-01',
    syncState: 'Draft',
  }];
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 6);
  assert.equal(await evaluate(`document.getElementById('tickets-badge').textContent`), '6');
  assert.equal(await evaluate(`document.querySelector('.ticket-row').classList.contains('is-draft')`), true);
  assert.equal(await evaluate(`document.querySelector('.ticket-row.is-draft .ticket-id-new').textContent`), '#NEW');
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.is-draft .ticket-hover-actions').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.is-draft [data-draft-action="sync"]').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.is-draft [data-ticket-action="browser"]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.is-draft [data-ticket-action="delete"]').length`), 0);
  await evaluate(`window.messages.length=0;document.querySelector('.ticket-row.is-draft').click()`);
  assert.deepEqual(await evaluate(`(({type,queueId})=>({type,queueId}))(window.messages.at(-1))`), { type: 'ticket.openDraft', queueId: 'draft-q1' });
  state.draftTickets = [];

  state.metadataOptions.statuses = [{ id: 1, name: 'Open', isClosed: false }, { id: 2, name: 'Closed', isClosed: true }];
  state.tickets = [{
    id: 100,
    subject: '親チケット',
    level: 0,
    statusId: 1,
    statusName: 'Open',
    dueDate: '2099-12-31',
    doneRatio: 50,
    syncState: 'Synced',
    children: [{
      id: 101,
      subject: '子高優先度',
      level: 1,
      statusId: 2,
      statusName: 'Closed',
      priorityName: 'High',
      dueDate: '2020-01-01',
      doneRatio: 100,
      syncState: 'Synced',
      children: [],
    }],
  }];
  state.loadedTicketCount = 2;
  state.totalTicketCount = 2;
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-progress, [role="progressbar"]').length`), 0, 'doneRatio があっても進捗線を表示しない');
  await evaluate(`document.querySelector('[data-expand="100"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-expand="100"]').getAttribute('aria-expanded')`), 'false');
  await evaluate(`document.querySelector('[data-quick-filter="high"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row').length`), 2);
  assert.equal(await evaluate(`document.querySelector('[data-expand="100"]').getAttribute('aria-expanded')`), 'true');
  await evaluate(`document.querySelector('[data-quick-filter="high"]').click();document.querySelector('[data-quick-filter="overdue"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row[data-id="101"]').length`), 0);
  await evaluate(`document.querySelector('[data-quick-filter="overdue"]').click()`);

  state.tickets = [{
    id: 200,
    subject: '連動親チケット',
    level: 0,
    statusId: 1,
    statusName: 'Open',
    syncState: 'Synced',
    children: [{
      id: 201,
      subject: '連動子チケット',
      level: 1,
      statusId: 1,
      statusName: 'Open',
      syncState: 'Synced',
      children: [],
    }],
  }];
  state.selectedTicketId = undefined;
  state.selectedTicket = undefined;
  state.loadedTicketCount = 2;
  state.totalTicketCount = 2;
  await push();
  await evaluate(`document.querySelector('[data-expand="200"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-expand="200"]').getAttribute('aria-expanded')`), 'false');
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row[data-id="201"]').length`), 0);
  state.selectedTicketId = 201;
  state.selectedTicket = { id: 201, subject: '連動子チケット', syncState: 'Synced' };
  await push();
  assert.equal(await evaluate(`document.querySelector('[data-expand="200"]').getAttribute('aria-expanded')`), 'true');
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="201"]').classList.contains('selected')`), true);

  state.draftTickets = [{
    queueId: 'draft-created',
    documentUri: 'file:///tmp/redmine-client-new-ticket-draft-created.md',
    subject: '新規登録確認',
    projectId: 1,
    statusName: 'Open',
    syncState: 'Draft',
  }];
  state.selectedTicketId = undefined;
  state.selectedTicket = undefined;
  await push();
  await evaluate(`document.querySelector('.ticket-row.is-draft[data-draft-queue-id="draft-created"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.ticket-row.is-draft[data-draft-queue-id="draft-created"]').classList.contains('selected')`), true);

  state.draftTickets = [];
  state.tickets = [...state.tickets, {
    id: 205,
    subject: '新規登録確認',
    level: 0,
    statusId: 1,
    statusName: 'Open',
    syncState: 'Synced',
    children: [],
  }];
  state.loadedTicketCount = 3;
  state.totalTicketCount = 3;
  state.selectedTicketId = 205;
  state.selectedTicket = { id: 205, subject: '新規登録確認', syncState: 'Synced' };
  await push();
  assert.equal(await evaluate(`document.querySelectorAll('.ticket-row.is-draft').length`), 0);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="205"]').classList.contains('selected')`), true);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="205"]').getAttribute('aria-current')`), 'true');

  await evaluate(`document.getElementById('tab-unsynced').click()`);
  assert.equal(await evaluate(`document.getElementById('panel-tickets').hidden`), true);
  state.tickets = [...state.tickets, {
    id: 206,
    subject: '別タブ作成確認',
    level: 0,
    statusId: 1,
    statusName: 'Open',
    syncState: 'Synced',
    children: [],
  }];
  state.loadedTicketCount = 4;
  state.totalTicketCount = 4;
  state.selectedTicketId = 206;
  state.selectedTicket = { id: 206, subject: '別タブ作成確認', syncState: 'Synced' };
  await push();
  await evaluate(`(()=>{window.__scrollCalls=0;const row=document.querySelector('.ticket-row[data-id="206"]');const orig=row.scrollIntoView;row.scrollIntoView=function(...args){window.__scrollCalls++;return orig.apply(this,args);};document.getElementById('tab-tickets').click();})()`);
  assert.equal(await evaluate(`window.__scrollCalls`), 1);
  assert.equal(await evaluate(`document.querySelector('.ticket-row[data-id="206"]').classList.contains('selected')`), true);
  await evaluate(`document.getElementById('tab-unsynced').click();document.getElementById('tab-tickets').click()`);
  assert.equal(await evaluate(`window.__scrollCalls`), 1);

  await evaluate(`window.messages.length=0;document.getElementById('tab-settings').click();document.getElementById('settings-tickets').open=true;document.getElementById('set-follow-active-editor').click()`);
  assert.deepEqual(await evaluate(`window.messages.find(m=>m.type==='settings.updateGeneral'&&m.patch&&'followActiveEditor' in m.patch)?.patch`), { followActiveEditor: true });
  await evaluate(`window.messages.length=0;document.getElementById('open-settings-json-btn').click()`);
  assert.equal(await evaluate(`window.messages.at(-1).type`), 'settings.openJson');
  await checkTicketSelectionHighlight();
  await checkDetailPanelResize();
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate('window.cspViolations'), [], 'Dashboard は CSP 違反を発生させない');
  console.log('PASS: Detail操作/状態9種/読み取り専用preview、Metadata一括適用/キャンセル/失敗/接続切替、同期二重送信防止/成功/失敗、日本語/IME/入力待機、番号・本文検索の要求/範囲切替、検索中の新規/子チケット入力保持、追加取得の一覧/スクロール/フォーカス保持/再試行、一覧の情報集約/表示件数、Settings セクション/編集/キーボード操作、折りたたみ維持、子チケット検索、メニューのキーボード操作/表示領域、タブ横断の新規作成、入力/フォーカス維持、下書き前の同期抑止、ローディング/エラー再試行、7画面幅、4テーマ');
  console.log('検証用 HTML: ' + fixture);
  console.log('Project picker screenshots: ' + path.join(directory, 'project-picker-search-440.png') + ', ' + path.join(directory, 'project-picker-search-320.png') + ', ' + path.join(directory, 'project-picker-search-440-dark.png'));
  console.log('Short viewport popup bounds: ' + JSON.stringify(shortViewportBounds));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome.kill();
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
});
