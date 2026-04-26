import * as crypto from "crypto";
import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { getTicketDraft } from "./ticketDraftStore";
import { getOfflineSyncQueue } from "./offlineSyncStore";

export const VIEW_ID_TICKET_WEBVIEW = "redmine-clientActivityTicketWebview";

// ── メッセージ型定義 ──────────────────────────────────────────────────────

interface UpdateMsg {
  type: "update";
  tickets: SerializedTicket[];
  totalCount: number;
  loadedCount: number;
  syncStatuses: Record<number, string>;
}

interface SerializedTicket {
  id: number;
  subject: string;
  statusName?: string;
  priorityName?: string;
  assigneeName?: string;
  trackerName?: string;
  dueDate?: string;
  parentId?: number;
}

type ToWebviewMsg = UpdateMsg;

type FromWebviewMsg =
  | { type: "ready" }
  | { type: "openTicket"; ticketId: number }
  | { type: "loadMore" };

// ── ヘルパー ──────────────────────────────────────────────────────────────

const buildSyncStatuses = (tickets: Ticket[]): Record<number, string> => {
  const queue = getOfflineSyncQueue();
  const result: Record<number, string> = {};
  for (const ticket of tickets) {
    const draft = getTicketDraft(ticket.id);
    if (draft && draft.status !== "Synced") {
      result[ticket.id] = draft.status;
    } else if (queue.tickets.has(ticket.id)) {
      result[ticket.id] = "Queued";
    }
  }
  return result;
};

const serializeTicket = (t: Ticket): SerializedTicket => ({
  id: t.id,
  subject: t.subject,
  statusName: t.statusName,
  priorityName: t.priorityName,
  assigneeName: t.assigneeName,
  trackerName: t.trackerName,
  dueDate: t.dueDate,
  parentId: t.parentId,
});

const generateNonce = (): string => crypto.randomBytes(16).toString("base64");

// ── Webview HTML ──────────────────────────────────────────────────────────

const buildHtml = (nonce: string, _cspSource: string): string => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* ── フィルターバー ── */
  #filter-bar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    flex-shrink: 0;
  }
  #search {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-size: inherit;
    font-family: inherit;
  }
  #search:focus { outline: 1px solid var(--vscode-focusBorder); }
  #search::placeholder { color: var(--vscode-input-placeholderForeground); }
  select {
    padding: 3px 4px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    border-radius: 2px;
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
  }

  /* ── チケットリスト ── */
  #list-wrapper {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  #ticket-list { width: 100%; }
  .ticket-row {
    display: flex;
    align-items: center;
    padding: 5px 8px;
    cursor: pointer;
    border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground, transparent);
    gap: 6px;
  }
  .ticket-row:hover { background: var(--vscode-list-hoverBackground); }
  .ticket-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .ticket-id {
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ticket-subject {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ticket-meta {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .badge {
    font-size: 0.75em;
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .badge.dirty { background: var(--vscode-list-warningForeground); color: var(--vscode-sideBar-background); }
  .badge.queued { background: var(--vscode-charts-blue, #007acc); color: #fff; }
  .badge.conflict { background: var(--vscode-list-errorForeground); color: #fff; }

  /* ── Load more ── */
  #load-more {
    padding: 6px 8px;
    text-align: center;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
    font-size: 0.85em;
    display: none;
  }
  #load-more:hover { text-decoration: underline; }

  /* ── 詳細パネル ── */
  #detail-panel {
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    padding: 8px;
    flex-shrink: 0;
    max-height: 160px;
    overflow-y: auto;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
  }
  #detail-panel h4 {
    font-size: 0.9em;
    color: var(--vscode-foreground);
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail-row { display: flex; gap: 8px; margin-top: 2px; }
  .detail-label { min-width: 60px; font-weight: 500; color: var(--vscode-foreground); }
  #empty-state {
    padding: 20px 8px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
</style>
</head>
<body>
<div id="filter-bar">
  <input id="search" type="text" placeholder="Search tickets…" autocomplete="off">
  <select id="status-filter"><option value="">All statuses</option></select>
  <select id="assignee-filter"><option value="">All assignees</option></select>
</div>
<div id="list-wrapper">
  <div id="ticket-list"></div>
  <div id="empty-state" style="display:none">No tickets match the filter.</div>
  <div id="load-more">Load more…</div>
</div>
<div id="detail-panel">
  <div style="color:var(--vscode-descriptionForeground);font-size:0.9em">Select a ticket to preview details.</div>
</div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();

  let allTickets = [];
  let totalCount = 0;
  let loadedCount = 0;
  let syncStatuses = {};
  let selectedId = null;

  const listEl = document.getElementById('ticket-list');
  const emptyEl = document.getElementById('empty-state');
  const loadMoreEl = document.getElementById('load-more');
  const detailEl = document.getElementById('detail-panel');
  const searchEl = document.getElementById('search');
  const statusEl = document.getElementById('status-filter');
  const assigneeEl = document.getElementById('assignee-filter');

  // ── フィルター ──────────────────────────────────────────────────────────

  function getFilteredTickets() {
    const query = searchEl.value.toLowerCase();
    const statusVal = statusEl.value;
    const assigneeVal = assigneeEl.value;
    return allTickets.filter(t => {
      if (query && !t.subject.toLowerCase().includes(query) && !String(t.id).includes(query)) return false;
      if (statusVal && t.statusName !== statusVal) return false;
      if (assigneeVal && (t.assigneeName || '') !== assigneeVal) return false;
      return true;
    });
  }

  function populateFilter(selectEl, values) {
    const current = selectEl.value;
    while (selectEl.options.length > 1) selectEl.remove(1);
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
    if (values.includes(current)) selectEl.value = current;
  }

  // ── レンダリング ────────────────────────────────────────────────────────

  function render() {
    const tickets = getFilteredTickets();
    listEl.innerHTML = '';

    if (tickets.length === 0) {
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';
    }

    tickets.forEach(t => {
      const row = document.createElement('div');
      row.className = 'ticket-row' + (t.id === selectedId ? ' selected' : '');
      row.dataset.id = t.id;

      const idEl = document.createElement('span');
      idEl.className = 'ticket-id';
      idEl.textContent = '#' + t.id;

      const subjectEl = document.createElement('span');
      subjectEl.className = 'ticket-subject';
      subjectEl.textContent = t.subject;
      subjectEl.title = t.subject;

      const metaEl = document.createElement('span');
      metaEl.className = 'ticket-meta';

      // 優先度バッジ
      if (t.priorityName) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = t.priorityName;
        metaEl.appendChild(b);
      }

      // ステータスバッジ
      if (t.statusName) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = t.statusName;
        metaEl.appendChild(b);
      }

      // 同期状態バッジ
      const syncStatus = syncStatuses[t.id];
      if (syncStatus) {
        const b = document.createElement('span');
        const cls = syncStatus === 'Dirty' || syncStatus === 'Queued' ? 'queued'
                  : syncStatus === 'Conflict' ? 'conflict'
                  : 'dirty';
        b.className = 'badge ' + cls;
        b.textContent = syncStatus;
        metaEl.appendChild(b);
      }

      row.appendChild(idEl);
      row.appendChild(subjectEl);
      row.appendChild(metaEl);

      row.addEventListener('click', () => {
        selectedId = t.id;
        render();
        renderDetail(t);
        vscode.postMessage({ type: 'openTicket', ticketId: t.id });
      });

      listEl.appendChild(row);
    });

    loadMoreEl.style.display = loadedCount < totalCount ? 'block' : 'none';
    if (loadedCount < totalCount) {
      loadMoreEl.textContent = 'Load more… (' + loadedCount + ' / ' + totalCount + ')';
    }
  }

  function renderDetail(t) {
    if (!t) {
      detailEl.innerHTML = '<div style="color:var(--vscode-descriptionForeground);font-size:0.9em">Select a ticket to preview details.</div>';
      return;
    }
    const syncStatus = syncStatuses[t.id];
    const rows = [
      ['Status', t.statusName || '—'],
      ['Priority', t.priorityName || '—'],
      ['Tracker', t.trackerName || '—'],
      ['Assignee', t.assigneeName || 'Unassigned'],
      ['Due', t.dueDate || '—'],
      ['Local', syncStatus || 'Synced'],
    ];
    const rowsHtml = rows.map(([label, value]) =>
      '<div class="detail-row"><span class="detail-label">' + label + '</span><span>' + escapeHtml(String(value)) + '</span></div>'
    ).join('');
    detailEl.innerHTML = '<h4>#' + t.id + ' ' + escapeHtml(t.subject) + '</h4>' + rowsHtml;
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── イベント ────────────────────────────────────────────────────────────

  searchEl.addEventListener('input', render);
  statusEl.addEventListener('change', render);
  assigneeEl.addEventListener('change', render);

  loadMoreEl.addEventListener('click', () => {
    vscode.postMessage({ type: 'loadMore' });
  });

  // ── Extension からのメッセージ ────────────────────────────────────────────

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'update') {
      allTickets = msg.tickets;
      totalCount = msg.totalCount;
      loadedCount = msg.loadedCount;
      syncStatuses = msg.syncStatuses;

      // フィルター選択肢を更新
      const statuses = [...new Set(allTickets.map(t => t.statusName).filter(Boolean))].sort();
      const assignees = [...new Set(allTickets.map(t => t.assigneeName).filter(Boolean))].sort();
      populateFilter(statusEl, statuses);
      populateFilter(assigneeEl, assignees);

      // 選択中チケットのdetailを更新
      const selected = allTickets.find(t => t.id === selectedId);
      renderDetail(selected || null);

      render();
    }
  });

  // 準備完了を通知
  vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;

// ── WebviewViewProvider ───────────────────────────────────────────────────

export interface TicketWebviewViewDeps {
  getTickets: () => Ticket[];
  getTotalCount: () => number;
  onTicketsChanged: (listener: () => void) => vscode.Disposable;
  loadMoreTickets: () => Promise<void>;
  openTicket: (ticketId: number) => Promise<void>;
}

export class TicketWebviewViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: TicketWebviewViewDeps,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const nonce = generateNonce();
    webviewView.webview.html = buildHtml(nonce, webviewView.webview.cspSource);

    // webview からのメッセージ処理
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (msg: FromWebviewMsg) => {
        if (token.isCancellationRequested) {
          return;
        }
        if (msg.type === "ready") {
          this.sendUpdate();
        } else if (msg.type === "openTicket") {
          await this.deps.openTicket(msg.ticketId);
        } else if (msg.type === "loadMore") {
          await this.deps.loadMoreTickets();
          this.sendUpdate();
        }
      }),
    );

    // チケットデータが変わったら webview を更新
    this.disposables.push(
      this.deps.onTicketsChanged(() => {
        this.sendUpdate();
      }),
    );

    // webview が再表示されたら更新
    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.sendUpdate();
        }
      }),
    );
  }

  private sendUpdate(): void {
    if (!this.view?.visible) {
      return;
    }
    const tickets = this.deps.getTickets();
    const msg: ToWebviewMsg = {
      type: "update",
      tickets: tickets.map(serializeTicket),
      totalCount: this.deps.getTotalCount(),
      loadedCount: tickets.length,
      syncStatuses: buildSyncStatuses(tickets),
    };
    void this.view.webview.postMessage(msg);
  }

  /** 外部から明示的に更新トリガーする場合 */
  refresh(): void {
    this.sendUpdate();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
