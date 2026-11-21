import * as assert from "assert";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { chooseConfirmation, openLiveDashboard } from "./dashboardHarness";
import { getTicketEditorDefaults, setTicketEditorDefaults, updateTicketEditorDefaultField } from "../../views/ticketEditorDefaultsStore";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { parseTicketEditorContent } from "../../views/ticketEditorContent";
import { createFaultProxy } from "./faultProxy";
import { resolveLiveUpstream } from "./liveFixture";
import { requestJson } from "../../redmine/client";
import { setApiKeyForScope } from "../../config/apiKeyStore";
import { getStoredTicketListSettings, setStoredTicketListSettings } from "../../views/ticketListSettingsStore";
import { syncEditorToRedmine } from "../../commands/syncToRedmine";
import { parseCommentCreateFile, parseCommentUpdateFile } from "../../views/commentUpdateFile";
import { liveTest, type LiveFixture } from "./liveFixture";

type Dashboard = Awaited<ReturnType<typeof openLiveDashboard>>;

const withDashboard = async (live: LiveFixture, run: (dashboard: Dashboard) => Promise<void>) => {
  const dashboard = await openLiveDashboard(live);
  try {
    await dashboard.dom("#tab-tickets");
    await dashboard.dom("#project-select-trigger");
    await dashboard.dom(`[role="option"][data-project-id="${live.projectId}"]`);
    await dashboard.waitFor(() => dashboard.store.getState().selectedProject?.id === live.projectId &&
      !dashboard.store.getState().loading.tickets, "fixture project");
    await run(dashboard);
  } finally {
    dashboard.dispose();
  }
};

const waitForRows = async (dashboard: Dashboard, ids: number[], excluded: number[] = []) => {
  const deadline = Date.now() + 15_000;
  let rows: string[];
  do {
    rows = await dashboard.read(".ticket-row[data-id]");
    if (ids.every((id) => rows.includes(String(id))) && excluded.every((id) => !rows.includes(String(id)))) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(`Expected rows ${ids} excluding ${excluded}, got ${rows}`);
};

const createProject = async (live: LiveFixture, identifier: string, parentId?: number) => {
  const { trackers } = await live.request<{ trackers: { id: number }[] }>({ method: "GET", path: "/trackers.json" });
  const { project } = await live.request<{ project: { id: number } }>({
    method: "POST", path: "/projects.json",
    body: { project: { name: identifier, identifier, parent_id: parentId, is_public: false,
      tracker_ids: trackers.map(({ id }) => id), enabled_module_names: ["issue_tracking"] } },
  });
  return project.id;
};

const deleteProject = async (live: LiveFixture, id: number) => {
  await live.request({ method: "DELETE", path: `/projects/${id}.json` });
};

liveTest("LIVE-B01", "実プロジェクトのピッカー検索と子プロジェクト切り替え", async (live) => {
  const identifier = `e2e-child-${randomUUID().slice(0, 8)}`;
  const childProject = await createProject(live, identifier, live.projectId);
  const configuration = vscode.workspace.getConfiguration("redmine-client");
  const previous = configuration.inspect<boolean>("includeChildProjects")?.globalValue;
  try {
    await configuration.update("includeChildProjects", false, vscode.ConfigurationTarget.Global);
    const parent = await live.createIssue();
    const child = await live.createIssue({ projectId: childProject });
    await withDashboard(live, async (dashboard) => {
      await waitForRows(dashboard, [parent], [child]);
      await dashboard.dom("#project-select-trigger");
      await dashboard.setValue("#project-search-input", identifier);
      const option = `[role="option"][data-project-id="${childProject}"]`;
      assert.strictEqual((await dashboard.read(option)).length, 1);
      assert.strictEqual(dashboard.store.getState().selectedProject?.id, live.projectId);
      await dashboard.dom(option);
      await waitForRows(dashboard, [child], [parent]);
      await dashboard.dom("#project-select-trigger");
      await dashboard.dom(`[role="option"][data-project-id="${live.projectId}"]`);
      await waitForRows(dashboard, [parent], [child]);
      await dashboard.dom("#include-children");
      await waitForRows(dashboard, [parent, child]);
      await dashboard.dom("#include-children");
      await waitForRows(dashboard, [parent], [child]);
    });
  } finally {
    await configuration.update("includeChildProjects", previous, vscode.ConfigurationTarget.Global);
    await deleteProject(live, childProject);
  }
});

liveTest("LIVE-B02", "件名・説明の実検索を統合し、範囲とIDで絞る", async (live) => {
  const term = `e2esearch${randomUUID().replace(/-/g, "")}`;
  const sibling = await createProject(live, `e2e-peer-${term.slice(-8)}`);
  try {
    const both = await live.createIssue({ subject: term, description: term });
    const description = await live.createIssue({ description: term });
    const outside = await live.createIssue({ projectId: sibling, subject: term });
    await withDashboard(live, async (dashboard) => {
      await dashboard.setValue("#search-input", term);
      const initial = await dashboard.read(".ticket-row[data-id]");
      const unrelated = initial.map(Number).filter((id) => id !== both && id !== description);
      const local = await waitForRows(dashboard, [both, description], [outside, ...unrelated]);
      assert.deepStrictEqual(local.slice().sort(), [both, description].map(String).sort());
      await dashboard.dom("#project-select-trigger");
      await dashboard.dom('[role="option"][data-project-id="0"]');
      const all = await waitForRows(dashboard, [both, description, outside]);
      assert.deepStrictEqual(all.slice().sort(), [both, description, outside].map(String).sort());
      await dashboard.setValue("#search-input", `#${outside}`);
      assert.deepStrictEqual(await waitForRows(dashboard, [outside], [both, description]), [String(outside)]);
    });
  } finally {
    await deleteProject(live, sibling);
  }
});

liveTest("LIVE-B03", "追加読み込みと期日・開始日の並び順を実一覧で確認する", async (live) => {
  const configuration = vscode.workspace.getConfiguration("redmine-client");
  const previous = configuration.inspect<number>("ticketListLimit")?.workspaceValue;
  const previousListSettings = getStoredTicketListSettings();
  const identifier = `e2e-sort-${randomUUID().slice(0, 8)}`;
  const projectId = await createProject(live, identifier);
  try {
    await configuration.update("ticketListLimit", 2, vscode.ConfigurationTarget.Workspace);
    const a = await live.createIssue({ projectId, startDate: "2026-01-02", dueDate: "2026-04-01" });
    const b = await live.createIssue({ projectId, startDate: "2026-01-01", dueDate: "2026-03-01" });
    const c = await live.createIssue({ projectId, startDate: "2026-01-03", dueDate: "2026-02-01" });
    const undated = await live.createIssue({ projectId });
    await withDashboard(live, async (dashboard) => {
      await dashboard.dom("#project-select-trigger");
      await dashboard.dom(`[role="option"][data-project-id="${projectId}"]`);
      await dashboard.waitFor(() => dashboard.store.getState().selectedProject?.id === projectId &&
        dashboard.store.getState().loadedTicketCount === 2, "first page");
      assert.strictEqual((await dashboard.read(".ticket-row[data-id]")).length, 2);
      await dashboard.dom("#load-more-row");
      const rows = await waitForRows(dashboard, [a, b, c, undated]);
      assert.strictEqual(rows.length, 4);
      for (const [field, expected] of [["dueDate", [c, b, a, undated]], ["startDate", [b, a, c, undated]]] as const) {
        await dashboard.dom("#tab-settings");
        await dashboard.setValue("#set-sort-field", field);
        await dashboard.waitFor(() => dashboard.store.getState().settings.sort.field === field, field);
        await dashboard.dom("#tab-tickets");
        assert.deepStrictEqual(await dashboard.read(".ticket-row[data-id]"), expected.map(String));
      }
    });
    const child = await live.createIssue({ projectId, parentId: a, startDate: "2026-01-03" });
    await configuration.update("ticketListLimit", 10, vscode.ConfigurationTarget.Workspace);
    await withDashboard(live, async (dashboard) => {
      assert.strictEqual(dashboard.store.getState().settings.sort.field, "startDate");
      await dashboard.dom("#project-select-trigger");
      await dashboard.dom(`[role="option"][data-project-id="${projectId}"]`);
      await waitForRows(dashboard, [a, b, c, undated]);
      const expand = `[data-expand="${a}"][aria-expanded="false"]`;
      if ((await dashboard.read(expand)).length > 0) {
        await dashboard.dom(expand);
      }
      const rows = await waitForRows(dashboard, [a, b, c, child, undated]);
      assert.strictEqual(rows[rows.indexOf(String(a)) + 1], String(child));
      assert.strictEqual(rows.at(-1), String(undated));
      assert.deepStrictEqual(await dashboard.read(`.ticket-row[data-id="${child}"][data-level="1"]`), [String(child)]);
    });
  } finally {
    setStoredTicketListSettings(previousListSettings);
    await configuration.update("ticketListLimit", previous, vscode.ConfigurationTarget.Workspace);
    await deleteProject(live, projectId);
  }
});

liveTest("LIVE-B04", "詳細画面からコメントMarkdownを開き追加・編集する", async (live) => {
  const issueId = await live.createIssue();
  const initial = "Original E2E note";
  const existing = "Existing E2E note";
  const revised = "Edited E2E note";
  await live.request({ method: "PUT", path: `/issues/${issueId}.json`, body: { issue: { notes: existing } } });
  const original = (await live.readIssue(issueId)).comments.find((comment) => comment.body.trim() === existing);
  assert.ok(original);
  await withDashboard(live, async (dashboard) => {
    await waitForRows(dashboard, [issueId]);
    await dashboard.dom(`.ticket-row[data-id="${issueId}"]`);
    await dashboard.waitFor(() => dashboard.store.getState().selectedTicket?.id === issueId &&
      new RegExp(`^issue_id: ${issueId}$`, "m").test(vscode.window.activeTextEditor?.document.getText() ?? ""),
    "selected ticket and editor");
    dashboard.reveal();
    await dashboard.waitFor(() => dashboard.store.getState().comments.items.some((comment) => comment.id === original.id), "existing comment");
    assert.ok((await dashboard.read("#comments-list .comment-body")).includes(existing));
    await dashboard.dom("#add-comment-btn");
    const editAndSync = async (text: string, status: "created" | "success") => {
      const editor = vscode.window.activeTextEditor;
      assert.ok(editor);
      const content = editor.document.getText();
      const offset = status === "success" ? content.lastIndexOf(existing) : content.length;
      assert.ok(offset >= 0);
      const start = editor.document.positionAt(offset);
      const end = editor.document.positionAt(status === "success" ? offset + existing.length : offset);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(editor.document.uri, new vscode.Range(start, end), `\n${text}\n`);
      assert.ok(await vscode.workspace.applyEdit(edit));
      if (status === "success") {
        assert.ok(await editor.document.save());
        const documentUri = editor.document.uri.toString();
        await dashboard.waitFor(() => getOfflineSyncQueue(live.scope).comments.some((comment) =>
          comment.documentUri === documentUri && comment.commentId === original.id && comment.body.trim() === text),
        "saved comment update");
        const result = await live.engine().syncOne({ kind: "comment", ticketId: issueId, commentId: original.id, documentUri }, live.context);
        assert.strictEqual(result.kind, "completed", JSON.stringify(result));
        return;
      }
      const sync = await syncEditorToRedmine(editor, { trigger: "explicit", syncEngine: live.engine() });
      assert.strictEqual(sync?.kind, "comment");
      const accepted = ["created", "created_unresolved"];
      assert.ok(sync && accepted.includes(sync.result.status), JSON.stringify(sync));
    };
    await dashboard.waitFor(() =>
      parseCommentCreateFile(vscode.window.activeTextEditor?.document.getText() ?? "")?.issueId === issueId,
    "comment create editor");
    await editAndSync(initial, "created");
    const created = (await live.readIssue(issueId)).comments.filter((comment) => comment.body.trim() === initial);
    assert.strictEqual(created.length, 1);
    dashboard.reveal();
    await dashboard.dom("#reload-comments-btn");
    await dashboard.waitFor(() => dashboard.store.getState().comments.items.some((comment) => comment.id === created[0].id), "saved comment");
    await dashboard.dom(`[data-edit-comment="${original.id}"]`);
    await dashboard.waitFor(() => {
      const editor = vscode.window.activeTextEditor;
      return Boolean(editor && parseCommentUpdateFile(editor.document.getText())?.fields.journalId === original.id);
    }, "registered comment update editor");
    await editAndSync(revised, "success");
    const updated = (await live.readIssue(issueId)).comments.find((comment) => comment.id === original.id);
    assert.strictEqual(updated?.body.trim(), revised);
  });
});

liveTest("LIVE-B05", "設定画面のAPIキー登録・削除と接続先の分離", async (live) => {
  const key = process.env.REDMINE_API_KEY;
  assert.ok(key);
  const second = await createFaultProxy(resolveLiveUpstream());
  const configuration = vscode.workspace.getConfiguration("redmine-client");
  const originalInput = vscode.window.showInputBox;
  const authorize = () => requestJson<{ user: { login: string } }>({ method: "GET", path: "/users/current.json" });
  try {
    await withDashboard(live, async (dashboard) => {
      await dashboard.dom("#tab-settings");
      await dashboard.dom("#clear-api-key-btn");
      await dashboard.waitFor(() => dashboard.store.getState().settings.apiKeyStatus === "notSet", "clear key");
      await assert.rejects(authorize, /API key/);
      vscode.window.showInputBox = async () => key;
      await dashboard.dom("#set-apikey-btn");
      await dashboard.waitFor(() => dashboard.store.getState().settings.apiKeyStatus === "set", "set key");
      assert.strictEqual((await authorize()).user.login, "admin");
      await configuration.update("baseUrl", second.origin, vscode.ConfigurationTarget.Workspace);
      await assert.rejects(authorize, /API key/);
      await configuration.update("baseUrl", live.scope, vscode.ConfigurationTarget.Workspace);
      assert.strictEqual((await authorize()).user.login, "admin");
    });
  } finally {
    vscode.window.showInputBox = originalInput;
    try {
      await configuration.update("baseUrl", live.scope, vscode.ConfigurationTarget.Workspace);
      await setApiKeyForScope(live.scope, key);
    } finally {
      await second.close();
    }
  }
});

liveTest("LIVE-B06", "Dashboard新規下書きと設定を保ったままキャッシュを再取得する", async (live) => {
  const defaults = getTicketEditorDefaults();
  const previousListSettings = getStoredTicketListSettings();
  const confirm = chooseConfirmation(vscode.l10n.t("Reset Dashboard Cache"));
  const subject = "LIVE-B06 new draft";
  const description = "Body from editor defaults";
  try {
    updateTicketEditorDefaultField("tracker", live.metadata.tracker);
    updateTicketEditorDefaultField("priority", live.metadata.priority);
    updateTicketEditorDefaultField("status", live.metadata.status);
    updateTicketEditorDefaultField("subject", subject);
    updateTicketEditorDefaultField("description", description);
    await vscode.commands.executeCommand("redmine-client.createTicketFromDashboard");
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    const draft = parseTicketEditorContent(editor.document.getText());
    assert.strictEqual(draft.controlFields?.project_id, live.projectId);
    assert.strictEqual(draft.subject, subject);
    assert.strictEqual(draft.description.trim(), description);
    await withDashboard(live, async (dashboard) => {
      assert.deepStrictEqual(await dashboard.read(".ticket-row.is-draft .ticket-id"), ["#NEW"]);
      await dashboard.dom("#tab-settings");
      await dashboard.setValue("#set-sort-field", "dueDate");
      await dashboard.waitFor(() => dashboard.store.getState().settings.sort.field === "dueDate", "sort setting");
      const before = live.proxy.hits().length;
      const { result } = await dashboard.click("#dashboard-cache-reset-btn");
      assert.strictEqual(result.type, "operation.success");
      assert.ok(live.proxy.hits().slice(before).some((hit) => hit.method === "GET" && hit.path === "/issues.json"));
      assert.strictEqual(dashboard.store.getState().settings.apiKeyStatus, "set");
      assert.strictEqual(dashboard.store.getState().settings.sort.field, "dueDate");
      await dashboard.dom("#tab-tickets");
      assert.deepStrictEqual(await dashboard.read(".ticket-row.is-draft .ticket-id"), ["#NEW"]);
      await dashboard.dom("#layout-btn");
      await dashboard.setValue("#ticket-layout-mode", "split");
      assert.strictEqual((await dashboard.read(".tickets-layout.layout-split")).length, 1);
      const high = '[data-quick-filter="high"]';
      await dashboard.dom(high);
      assert.strictEqual((await dashboard.read(`${high}[data-preferred="true"]`)).length, 1);
      await dashboard.dom("#tab-settings");
      await dashboard.dom("#settings-reset-view-btn");
      assert.strictEqual((await dashboard.read(`${high}[data-preferred="false"]`)).length, 1);
      assert.strictEqual((await dashboard.read(".tickets-layout.layout-split")).length, 0);
      assert.strictEqual(dashboard.store.getState().settings.sort.field, "dueDate");
      await dashboard.dom("#reset-editor-defaults-btn");
      await dashboard.waitFor(() => dashboard.store.getState().settings.editorDefaults.subject === "", "reset defaults");
    });
    const synced = await syncEditorToRedmine(editor, { trigger: "explicit", syncEngine: live.engine() });
    assert.strictEqual(synced?.result.status, "created");
    const issueId = parseTicketEditorContent(editor.document.getText()).controlFields?.issue_id;
    assert.ok(issueId);
    const { ticket } = await live.readIssue(issueId);
    assert.strictEqual(ticket.projectId, live.projectId);
    assert.strictEqual(ticket.subject, subject);
    assert.strictEqual(ticket.description?.trim(), description);
    await vscode.commands.executeCommand("redmine-client.createTicketFromDashboard");
    const next = vscode.window.activeTextEditor;
    assert.ok(next);
    assert.match(next.document.getText(), /^mode: ticket-create$/m);
    assert.ok(next.document.getText().includes(vscode.l10n.t("Enter new ticket subject")));
  } finally {
    confirm.dispose();
    setTicketEditorDefaults(defaults);
    setStoredTicketListSettings(previousListSettings);
  }
});
