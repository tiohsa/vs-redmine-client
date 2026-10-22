import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getOfflineSyncQueue, addOfflineTicketUpdateAsync } from "../../views/offlineSyncStore";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { initializeTicketDraft } from "../../views/ticketDraftStore";
import { registerTicketEditor } from "../../views/ticketEditorRegistry";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { liveTest } from "./liveFixture";
import { chooseConfirmation, openLiveDashboard } from "./dashboardHarness";

liveTest("LIVE-U01", "実Webviewの同期ボタン連打でも更新PUTは一回だけ", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-U01 UI update" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "delay_after", delayMs: 400 });
  const ui = await openLiveDashboard(live);
  try {
    const { result, snapshot } = await ui.click("[data-sync-key]", true);
    assert.strictEqual(result.type, "operation.success");
    assert.match(snapshot.feedback, /Sync completed/);
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.size, 0);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-U01 UI update");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 1);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U02", "実Webviewから新規チケットと添付を作成する", async (live) => {
  const filePath = path.join(live.directory, "ui-attachment.txt");
  fs.writeFileSync(filePath, "UI attachment 日本語");
  await live.queueNewTicket({ subject: "LIVE-U02 UI create", attachments: [{ kind: "file", filePath }] });
  const ui = await openLiveDashboard(live);
  try {
    assert.strictEqual((await ui.click("[data-sync-key]")).result.type, "operation.success");
    const response = await live.request<{ issues: Array<{ id: number; subject: string }> }>({
      method: "GET", path: "/issues.json", query: { project_id: live.projectId, status_id: "*" },
    });
    const created = response.issues.find((issue) => issue.subject === "LIVE-U02 UI create");
    assert.ok(created);
    const detail = await live.request<{ issue: { attachments: Array<{ filename: string }> } }>({
      method: "GET", path: `/issues/${created.id}.json`, query: { include: "attachments" },
    });
    assert.ok(detail.issue.attachments.some((item) => item.filename === "ui-attachment.txt"));
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/issues.json").length, 1);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U03", "同一ticketの複数コメントから選択したoperationIdだけを送信する", async (live) => {
  const id = await live.createIssue();
  const first = await live.queueComment(id, "LIVE-U03 first", { documentUri: "test://ui/first" });
  const second = await live.queueComment(id, "LIVE-U03 second", { documentUri: "test://ui/second" });
  const ui = await openLiveDashboard(live);
  try {
    // 文書URIに依存せず、実際の行に含まれるoperationIdの保持を検証する。
    const { result } = await ui.click(`[data-sync-key*='${second.operationId}']`);
    assert.strictEqual(result.type, "operation.success");
    const remote = await live.readIssue(id);
    assert.ok(remote.comments.some((comment) => comment.body === "LIVE-U03 second"));
    assert.ok(!remote.comments.some((comment) => comment.body === "LIVE-U03 first"));
    assert.ok(getOfflineSyncQueue(live.scope).comments.some((comment) => comment.operationId === first.operationId));
  } finally { ui.dispose(); }
});

liveTest("LIVE-U04", "応答喪失の警告・復旧キャンセル・read-back復旧を画面から実行する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-U04 applied" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  const ui = await openLiveDashboard(live);
  try {
    const initial = await ui.click("[data-sync-key]");
    assert.ok(initial.snapshot.feedbackClass.includes("warning"));
    assert.match(initial.snapshot.text, /Remote outcome unknown/);
    const before = getOfflineSyncQueue(live.scope);
    const cancel = chooseConfirmation();
    try {
      const result = await ui.click("[data-sync-key]");
      assert.match(result.snapshot.feedback, /cancelled/);
      assert.ok(result.snapshot.feedbackClass.includes("info"));
      assert.deepStrictEqual(getOfflineSyncQueue(live.scope), before);
    } finally { cancel.dispose(); }
    const reconcile = chooseConfirmation(vscode.l10n.t("Reconcile from Redmine"));
    try { assert.strictEqual((await ui.click("[data-sync-key]")).result.type, "operation.success"); }
    finally { reconcile.dispose(); }
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.size, 0);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-U04 applied");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 1);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U05", "画面から送信前の変更を破棄してremoteを維持する", async (live) => {
  const id = await live.createIssue();
  const before = await live.readIssue(id);
  await live.queueTicket(id, { subject: "LIVE-U05 discarded" });
  const ui = await openLiveDashboard(live);
  const confirm = chooseConfirmation(vscode.l10n.t("Discard"));
  try {
    assert.strictEqual((await ui.click("[data-discard-key]")).result.type, "operation.success");
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.size, 0);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, before.ticket.subject);
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
  } finally { confirm.dispose(); ui.dispose(); }
});

liveTest("LIVE-U06", "結果不明を画面から同期放棄してremoteと処理記録を保持する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-U06 retained" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  const ui = await openLiveDashboard(live);
  try {
    await ui.click("[data-sync-key]");
    await ui.dom(".unsynced-more summary");
    const confirm = chooseConfirmation(vscode.l10n.t("Abandon sync and exclude"));
    try { await ui.click("[data-abandon-key]"); } finally { confirm.dispose(); }
    assert.strictEqual(ui.store.getState().unsynced.totalCount, 0);
    assert.strictEqual(ui.store.getState().unsynced.abandonedItems?.length, 1);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-U06 retained");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "DELETE").length, 0);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U07", "競合の確認を画面から開いてキャンセルしても本文を保持する", async (live) => {
  const id = await live.createIssue({ description: "Base" });
  const detail = await live.readIssue(id);
  const metadata = metadataFromTicket(detail.ticket);
  const content = buildTicketEditorContent({ subject: detail.ticket.subject, description: "Local", metadata });
  const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(id, editor, "primary", "ticket", live.projectId, live.scope);
  initializeTicketDraft(id, detail.ticket.subject, "Base", metadata, detail.ticket.updatedAt, live.scope);
  await live.queueTicket(id, { description: "Local", content: document.getText(), documentUri: document.uri.toString(), lastKnownRemoteUpdatedAt: "2000-01-01T00:00:00Z" });
  await live.request({ method: "PUT", path: `/issues/${id}.json`, body: { issue: { description: "Remote" } } });
  const ui = await openLiveDashboard(live);
  const cancel = chooseConfirmation();
  try {
    await ui.click("[data-sync-key]");
    assert.ok(getOfflineSyncQueue(live.scope).tickets.has(id));
    assert.strictEqual(document.getText(), content);
    assert.strictEqual((await live.readIssue(id)).ticket.description, "Remote");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
  } finally { cancel.dispose(); ui.dispose(); }
});

liveTest("LIVE-U08", "全件同期ボタンから新規・更新・コメントを送信する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-U08 all" });
  await live.queueComment(id, "LIVE-U08 comment");
  await live.queueNewTicket({ subject: "LIVE-U08 create" });
  const ui = await openLiveDashboard(live);
  try {
    const result = await ui.click("#sync-all-btn", true);
    assert.strictEqual(result.result.type, "operation.success");
    assert.strictEqual(ui.store.getState().unsynced.totalCount, 0);
    const remote = await live.readIssue(id);
    assert.strictEqual(remote.ticket.subject, "LIVE-U08 all");
    assert.ok(remote.comments.some((comment) => comment.body === "LIVE-U08 comment"));
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/issues.json").length, 1);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U09", "ローカル処理待ちの案内から文書を開いて再作成せず完了する", async (live) => {
  const content = buildTicketEditorContent({ subject: "LIVE-U09 closed", description: "body", metadata: live.metadata });
  const uri = vscode.Uri.file(path.join(live.directory, "ui-closed.md"));
  fs.writeFileSync(uri.fsPath, content);
  await live.queueNewTicket({ subject: "LIVE-U09 closed", description: "body", content, documentUri: uri.toString() });
  const ui = await openLiveDashboard(live);
  try {
    const first = await ui.click("[data-sync-key]");
    assert.ok(first.snapshot.feedbackClass.includes("warning"));
    assert.match(first.snapshot.feedback, /Changes are on Redmine/);
    await ui.dom("[data-uri]");
    await ui.waitFor(() => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === uri.toString()), "ローカル文書を開く");
    assert.strictEqual((await ui.click("[data-sync-key]")).result.type, "operation.success");
    assert.strictEqual(getOfflineSyncQueue(live.scope).newTickets.length, 0);
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/issues.json").length, 1);
  } finally { ui.dispose(); }
});

liveTest("LIVE-U10", "送信中に追加した編集を残し完了通知に未同期変更を表示する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-U10 sent" });
  const original = getOfflineSyncQueue(live.scope).tickets.get(id);
  assert.ok(original);
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "delay_after", delayMs: 1000 });
  const ui = await openLiveDashboard(live);
  try {
    const completed = ui.click("[data-sync-key]");
    await ui.waitFor(() => live.proxy.hits().some((hit) => hit.method === "PUT"), "送信中");
    await addOfflineTicketUpdateAsync(id, { ...original, subject: "LIVE-U10 later" }, live.scope);
    const result = await completed;
    assert.match(result.snapshot.feedback, /Later local changes/);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-U10 sent");
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.get(id)?.subject, "LIVE-U10 later");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 1);
  } finally { ui.dispose(); }
});
