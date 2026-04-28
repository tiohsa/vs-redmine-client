import { getDashboardStyles } from "./dashboardStyles";

export const generateDashboardHtml = (nonce: string): string => {
  const styles = getDashboardStyles();

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redmine Dashboard</title>
  <style nonce="${nonce}">${styles}</style>
</head>
<body>
  <div id="app">
    <!-- Header: project selector + actions -->
    <div class="header">
      <select id="project-select" aria-label="プロジェクト選択">
        <option value="">-- プロジェクトを選択 --</option>
      </select>
      <button class="header-btn" id="btn-refresh" title="プロジェクト更新" aria-label="プロジェクト更新">↻</button>
      <button class="header-btn primary" id="btn-new-ticket" title="新規チケット" aria-label="新規チケット作成">+ チケット</button>
    </div>

    <!-- Tabs -->
    <div id="tabs" role="tablist" aria-label="ダッシュボードタブ">
      <button class="tab active" role="tab" aria-selected="true" aria-controls="panel-tickets" data-tab="tickets">
        チケット <span class="badge" id="badge-tickets"></span>
      </button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-comments" data-tab="comments">
        コメント
      </button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-unsynced" data-tab="unsynced">
        未同期 <span class="badge" id="badge-unsynced"></span>
      </button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings">
        設定
      </button>
    </div>

    <!-- Tickets panel -->
    <div id="panel-tickets" class="panel active" role="tabpanel" aria-labelledby="tab-tickets">
      <div id="ticket-list"></div>
      <button class="load-more" id="btn-load-more" style="display:none">さらに読み込む</button>
      <div id="ticket-detail"></div>
    </div>

    <!-- Comments panel -->
    <div id="panel-comments" class="panel" role="tabpanel" aria-labelledby="tab-comments">
      <div id="comment-list"></div>
    </div>

    <!-- Unsynced panel -->
    <div id="panel-unsynced" class="panel" role="tabpanel" aria-labelledby="tab-unsynced">
      <button class="sync-all-btn" id="btn-sync-all">すべて同期</button>
      <div id="unsynced-list"></div>
    </div>

    <!-- Settings panel -->
    <div id="panel-settings" class="panel" role="tabpanel" aria-labelledby="tab-settings">
      <div id="settings-form"></div>
    </div>
  </div>

  <div id="toast-container" role="status" aria-live="polite" aria-atomic="false"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── State ─────────────────────────────────────────────────────────────────
    let state = {
      projects: [],
      selectedProjectId: null,
      tickets: [],
      ticketsTotalCount: 0,
      ticketsOffset: 0,
      selectedTicketId: null,
      ticketDetail: null,
      comments: [],
      unsynced: [],
      expandedTicketIds: [],
      settings: {
        offlineSyncMode: 'auto',
        includeChildProjects: false,
        ticketListLimit: 50,
        titleFilter: '',
        sortField: 'id',
        sortOrder: 'desc',
        showDueDateIndicator: true,
      },
      activeTab: 'tickets',
      loading: false,
      error: null,
    };

    // ── Messaging ─────────────────────────────────────────────────────────────
    const post = (msg) => vscode.postMessage(msg);

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'state.patch') {
        state = deepMerge(state, msg.patch);
        render();
      } else if (msg.type === 'toast.info') {
        showToast(msg.message, 'info');
      } else if (msg.type === 'toast.warning') {
        showToast(msg.message, 'warning');
      } else if (msg.type === 'toast.error') {
        showToast(msg.message, 'error');
      }
    });

    function deepMerge(base, patch) {
      if (!patch || typeof patch !== 'object') return patch ?? base;
      const result = Object.assign({}, base);
      for (const key of Object.keys(patch)) {
        if (patch[key] !== null && typeof patch[key] === 'object' && !Array.isArray(patch[key]) &&
            typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
          result[key] = deepMerge(base[key], patch[key]);
        } else {
          result[key] = patch[key];
        }
      }
      return result;
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    function showToast(message, kind = 'info') {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = 'toast ' + kind;
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
      setTimeout(() => el.remove(), 3200);
    }

    // ── Tab handling ──────────────────────────────────────────────────────────
    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });

    document.getElementById('tabs').addEventListener('keydown', (e) => {
      const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"]'));
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === 'ArrowRight') { tabs[(idx + 1) % tabs.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); e.preventDefault(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
    });

    function switchTab(tab) {
      state.activeTab = tab;
      document.querySelectorAll('.tab').forEach(t => {
        const active = t.dataset.tab === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.toggle('active', p.id === 'panel-' + tab);
      });
      post({ type: 'tab.switch', tab });
    }

    // ── Header actions ────────────────────────────────────────────────────────
    document.getElementById('project-select').addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) post({ type: 'project.select', projectId: val });
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      post({ type: 'project.refresh' });
    });

    document.getElementById('btn-new-ticket').addEventListener('click', () => {
      post({ type: 'ticket.createNew' });
    });

    document.getElementById('btn-sync-all').addEventListener('click', () => {
      post({ type: 'unsynced.syncAll' });
    });

    document.getElementById('btn-load-more').addEventListener('click', () => {
      post({ type: 'tickets.loadMore' });
    });

    // ── Render ────────────────────────────────────────────────────────────────
    function render() {
      renderProjectSelect();
      renderTicketList();
      renderTicketDetail();
      renderComments();
      renderUnsynced();
      renderSettings();
      renderBadges();
    }

    function renderProjectSelect() {
      const sel = document.getElementById('project-select');
      const prev = sel.value;
      sel.innerHTML = '<option value="">-- プロジェクトを選択 --</option>';
      for (const p of state.projects) {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = p.name;
        if (p.id === state.selectedProjectId) opt.selected = true;
        sel.appendChild(opt);
      }
      if (!state.selectedProjectId && prev) sel.value = prev;
    }

    function getVisibleTickets() {
      const expanded = new Set(state.expandedTicketIds);
      const hidden = new Set();
      const result = [];
      for (const t of state.tickets) {
        if (t.parentId && !expanded.has(t.parentId)) {
          hidden.add(t.id);
          continue;
        }
        result.push(t);
      }
      return result;
    }

    function renderTicketList() {
      const container = document.getElementById('ticket-list');
      const visible = getVisibleTickets();
      const hasMore = state.ticketsOffset + (state.settings.ticketListLimit || 50) < state.ticketsTotalCount;

      if (visible.length === 0 && !state.loading) {
        container.innerHTML = '<div class="empty-state">チケットがありません。</div>';
        document.getElementById('btn-load-more').style.display = 'none';
        return;
      }

      const hasChildMap = new Set(state.tickets.filter(t => t.parentId).map(t => t.parentId));
      const expanded = new Set(state.expandedTicketIds);

      container.innerHTML = '';
      for (const t of visible) {
        const row = document.createElement('div');
        row.className = 'ticket-row' + (t.id === state.selectedTicketId ? ' selected' : '');
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-pressed', String(t.id === state.selectedTicketId));
        row.dataset.id = String(t.id);

        const indent = t.parentId ? 16 : 0;
        row.style.paddingLeft = (10 + indent) + 'px';

        if (hasChildMap.has(t.id)) {
          const btn = document.createElement('button');
          btn.className = 'expand-btn';
          btn.setAttribute('aria-label', expanded.has(t.id) ? '折りたたむ' : '展開');
          btn.setAttribute('aria-expanded', String(expanded.has(t.id)));
          btn.textContent = expanded.has(t.id) ? '⌄' : '›';
          btn.addEventListener('click', (ev) => { ev.stopPropagation(); post({ type: 'ticket.toggleExpand', ticketId: t.id }); });
          row.appendChild(btn);
        } else {
          const spacer = document.createElement('span');
          spacer.className = 'expand-spacer';
          row.appendChild(spacer);
        }

        const idEl = document.createElement('span');
        idEl.className = 'ticket-id';
        idEl.textContent = '#' + t.id;
        row.appendChild(idEl);

        const subj = document.createElement('span');
        subj.className = 'ticket-subject';
        subj.textContent = t.subject;
        row.appendChild(subj);

        if (state.settings.showDueDateIndicator && t.dueDate) {
          const today = new Date().toISOString().slice(0, 10);
          const due = document.createElement('span');
          due.className = 'due-indicator ' + (t.dueDate < today ? 'overdue' : 'soon');
          due.setAttribute('aria-label', t.dueDate < today ? '期限超過' : '期限間近');
          row.appendChild(due);
        }

        row.addEventListener('click', () => post({ type: 'ticket.select', ticketId: t.id }));
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); post({ type: 'ticket.select', ticketId: t.id }); }
        });

        container.appendChild(row);
      }

      document.getElementById('btn-load-more').style.display = hasMore ? 'block' : 'none';
    }

    function renderTicketDetail() {
      const container = document.getElementById('ticket-detail');
      const t = state.ticketDetail;
      if (!t) { container.innerHTML = ''; return; }

      const chips = [
        t.statusName && { label: t.statusName },
        t.priorityName && { label: t.priorityName },
        t.trackerName && { label: t.trackerName },
        t.assigneeName && { label: '担当: ' + t.assigneeName },
        t.dueDate && { label: '期日: ' + t.dueDate },
      ].filter(Boolean);

      container.innerHTML = \`
        <div class="detail-card">
          <div class="detail-title">#\${t.id} \${esc(t.subject)}</div>
          <div class="detail-meta">
            \${chips.map(c => \`<span class="meta-chip">\${esc(c.label)}</span>\`).join('')}
          </div>
          <div class="detail-actions">
            <button class="action-btn primary" onclick="post({type:'ticket.openInEditor',ticketId:\${t.id}})">エディタで開く</button>
            <button class="action-btn" onclick="post({type:'ticket.openInBrowser',ticketId:\${t.id}})">ブラウザで開く</button>
            <button class="action-btn" onclick="post({type:'ticket.createChild',parentTicketId:\${t.id}})">子チケット作成</button>
            <button class="action-btn" onclick="post({type:'comment.add',ticketId:\${t.id}})">コメント追加</button>
          </div>
        </div>
      \`;
    }

    function renderComments() {
      const container = document.getElementById('comment-list');
      if (!state.selectedTicketId) {
        container.innerHTML = '<div class="empty-state">チケットを選択してください。</div>';
        return;
      }
      if (state.comments.length === 0) {
        container.innerHTML = '<div class="empty-state">コメントがありません。</div>';
        return;
      }
      container.innerHTML = state.comments.map(c => \`
        <div class="comment-card">
          <div class="comment-header">
            <span class="comment-author">\${esc(c.authorName)}</span>
            <span class="comment-date">\${esc(c.createdAt || '')}</span>
          </div>
          <div class="comment-body">\${esc(c.body)}</div>
          \${c.editableByCurrentUser ? \`
            <div class="comment-actions">
              <button class="action-btn" onclick="post({type:'comment.edit',ticketId:\${c.ticketId},commentId:\${c.id}})">編集</button>
            </div>\` : ''}
        </div>
      \`).join('');
    }

    function renderUnsynced() {
      const container = document.getElementById('unsynced-list');
      if (state.unsynced.length === 0) {
        container.innerHTML = '<div class="empty-state">未同期のファイルはありません。</div>';
        return;
      }
      container.innerHTML = state.unsynced.map((u, i) => {
        const openBtn = u.documentUri
          ? \`<button class="action-btn" onclick="openLocal('\${esc(u.documentUri)}','\${i}')">開く</button>\`
          : '';
        return \`
          <div class="unsynced-card">
            <span class="unsynced-label">\${esc(u.label)}</span>
            <div class="unsynced-actions">
              \${openBtn}
              <button class="action-btn primary" onclick="syncOne(\${i})">同期</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function openLocal(uri, idx) {
      const requestId = 'open-' + idx + '-' + Date.now();
      post({ type: 'unsynced.openLocalFile', documentUri: uri, requestId });
    }

    function syncOne(idx) {
      const u = state.unsynced[idx];
      if (!u) return;
      post({ type: 'unsynced.syncOne', kind: u.kind, ticketId: u.ticketId, commentId: u.commentId, documentUri: u.documentUri });
    }

    function renderSettings() {
      const container = document.getElementById('settings-form');
      const s = state.settings;
      container.innerHTML = \`
        <div class="settings-section">
          <div class="settings-section-title">同期</div>
          <div class="settings-row">
            <span class="settings-label">オフライン同期モード</span>
            <select id="setting-offlineSyncMode" aria-label="オフライン同期モード">
              <option value="auto" \${s.offlineSyncMode === 'auto' ? 'selected' : ''}>自動</option>
              <option value="manual" \${s.offlineSyncMode === 'manual' ? 'selected' : ''}>手動</option>
            </select>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">一般</div>
          <div class="settings-row">
            <span class="settings-label">子プロジェクトを含める</span>
            <input type="checkbox" id="setting-includeChildProjects" aria-label="子プロジェクトを含める"
              \${s.includeChildProjects ? 'checked' : ''}>
          </div>
          <div class="settings-row">
            <span class="settings-label">チケット取得件数</span>
            <input type="number" id="setting-ticketListLimit" aria-label="チケット取得件数"
              value="\${s.ticketListLimit}" min="1" max="100">
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">チケット表示</div>
          <div class="settings-row">
            <span class="settings-label">件名フィルター</span>
            <input type="text" id="setting-titleFilter" aria-label="件名フィルター" value="\${esc(s.titleFilter)}">
          </div>
          <div class="settings-row">
            <span class="settings-label">期日インジケーター</span>
            <input type="checkbox" id="setting-showDueDateIndicator" aria-label="期日インジケーター"
              \${s.showDueDateIndicator ? 'checked' : ''}>
          </div>
        </div>
      \`;
      bindSettingsListeners();
    }

    function bindSettingsListeners() {
      const changes = {};
      const debounced = debounce(() => {
        if (Object.keys(changes).length > 0) {
          post({ type: 'settings.update', settings: Object.assign({}, changes) });
        }
      }, 300);

      const bind = (id, key, transform) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
          changes[key] = transform(el);
          state.settings[key] = changes[key];
          debounced();
        });
      };

      bind('setting-offlineSyncMode', 'offlineSyncMode', el => el.value);
      bind('setting-includeChildProjects', 'includeChildProjects', el => el.checked);
      bind('setting-ticketListLimit', 'ticketListLimit', el => parseInt(el.value, 10) || 50);
      bind('setting-titleFilter', 'titleFilter', el => el.value);
      bind('setting-showDueDateIndicator', 'showDueDateIndicator', el => el.checked);
    }

    function renderBadges() {
      const bt = document.getElementById('badge-tickets');
      const bu = document.getElementById('badge-unsynced');
      if (bt) bt.textContent = state.ticketsTotalCount > 0 ? String(state.ticketsTotalCount) : '';
      if (bu) bu.textContent = state.unsynced.length > 0 ? String(state.unsynced.length) : '';
    }

    // ── Utilities ─────────────────────────────────────────────────────────────
    function esc(str) {
      return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function debounce(fn, ms) {
      let t;
      return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    post({ type: 'dashboard.ready' });
  </script>
</body>
</html>`;
};
