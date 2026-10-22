import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { performSyncOnSave } from "../../app/saveSyncExecutor";
import { syncEditorToRedmine } from "../../commands/syncToRedmine";
import { initializeTicketDraft } from "../../views/ticketDraftStore";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { registerTicketEditor } from "../../views/ticketEditorRegistry";
import {
  getOfflineSyncQueue, prepareOfflineDiscard, commitOfflineDiscardAsync,
  prepareOfflineAbandon, commitOfflineAbandonAsync,
} from "../../views/offlineSyncStore";
import { DashboardStateStore } from "../../dashboard/DashboardStateStore";
import { DashboardUnsyncedService } from "../../dashboard/services/DashboardUnsyncedService";
import { liveTest, type LiveFixture } from "./liveFixture";

const presentation = {
  refresh: () => undefined, notifyChange: () => undefined,
  refreshForTicket: () => undefined, updateTicketSubject: () => undefined,
  setSelectedProjectId: async () => undefined,
};
const editorForTicket = async (live: LiveFixture) => {
  const id = await live.createIssue();
  const detail = await live.readIssue(id);
  const metadata = metadataFromTicket(detail.ticket);
  const subject = `${detail.ticket.subject} changed`;
  const content = buildTicketEditorContent({ subject, description: "Edited body", metadata });
  const uri = vscode.Uri.file(path.join(live.directory, `entrypoint-${id}.md`));
  fs.writeFileSync(uri.fsPath, content);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(id, editor, "primary", "ticket", live.projectId, live.scope);
  initializeTicketDraft(id, detail.ticket.subject, detail.ticket.description ?? "", metadata, detail.ticket.updatedAt, live.scope);
  return { id, subject, editor };
};

for (const mode of ["manual", "auto"] as const) {
  liveTest(mode === "manual" ? "LIVE-E01" : "LIVE-E02", `${mode}保存から本番同期エンジンを呼び分ける`, async (live) => {
    const item = await editorForTicket(live);
    await performSyncOnSave(item.editor.document, item.editor, {
      ticketsPresentation: presentation, commentsPresentation: presentation, unsyncedPresentation: presentation,
      notifications: { notifyTicketSaveResult: () => undefined, notifyCommentSaveResult: () => undefined },
      updateTicketListSubject: () => undefined, offlineSyncMode: mode, syncEngine: live.engine(),
      resolveTicketConflict: async (result) => {
        assert.fail(`正常な保存で競合しました: ${JSON.stringify(result)}`);
      },
    });
    const remote = await live.readIssue(item.id);
    if (mode === "auto") {
      assert.strictEqual(remote.ticket.subject, item.subject);
      assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(item.id), false);
    } else {
      assert.notStrictEqual(remote.ticket.subject, item.subject);
      assert.ok(getOfflineSyncQueue(live.scope).tickets.has(item.id));
      assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
    }
  });
}

liveTest("LIVE-E03", "明示同期コマンドの入口から実文書を同期する", async (live) => {
  const item = await editorForTicket(live);
  const result = await syncEditorToRedmine(item.editor, { trigger: "explicit", syncEngine: live.engine() });
  assert.strictEqual(result?.result.status, "success");
  assert.strictEqual((await live.readIssue(item.id)).ticket.subject, item.subject);
});
liveTest("LIVE-E04", "一括同期でチケット更新・新規作成・コメント作成を完了する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-E04 updated" });
  await live.queueNewTicket({ subject: "LIVE-E04 new" });
  await live.queueComment(id, "LIVE-E04 comment");
  const result = await live.engine().syncAll(live.context);
  assert.strictEqual(result.stopReason, "completed");
  assert.strictEqual(result.results.length, 3);
  assert.ok(result.results.every((item) => item.outcome.kind === "completed"));
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-E04 updated");
  assert.ok((await live.readIssue(id)).comments.some((comment) => comment.body === "LIVE-E04 comment"));
});
liveTest("LIVE-E05", "一括同期は結果不明となった項目で停止して残件を保持する", async (live) => {
  const first = await live.createIssue();
  const second = await live.createIssue();
  await live.queueTicket(first, { subject: "LIVE-E05 first" });
  await live.queueTicket(second, { subject: "LIVE-E05 second" });
  live.proxy.arm({ method: "PUT", path: `/issues/${first}.json`, mode: "drop_after" });
  const result = await live.engine().syncAll(live.context);
  assert.strictEqual(result.stopReason, "blocked_by_recovery");
  assert.strictEqual(result.remaining.length, 1);
  assert.notStrictEqual((await live.readIssue(second)).ticket.subject, "LIVE-E05 second");
});
liveTest("LIVE-E06", "一括同期のキャンセルは残りの書き込みを開始しない", async (live) => {
  const ids = await Promise.all([live.createIssue(), live.createIssue(), live.createIssue()]);
  for (const id of ids) { await live.queueTicket(id, { subject: `LIVE-E06 ${id}` }); }
  const result = await live.engine().syncAll(live.context, {
    shouldContinue: () => live.proxy.hits().filter((hit) => hit.method === "PUT").length < 1,
  });
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 1);
  assert.ok(result.remaining.length >= 1);
});
for (const sameEngine of [true, false]) {
  liveTest(sameEngine ? "LIVE-E07" : "LIVE-E08", `${sameEngine ? "同一" : "別"}Coordinatorの並行同期でも書き込みは一回だけ`, async (live) => {
    const id = await live.createIssue();
    const key = await live.queueTicket(id, { subject: "LIVE concurrent" });
    const engine = live.engine();
    const second = sameEngine ? engine : live.engine();
    const results = await Promise.all([engine.syncOne(key, live.context), second.syncOne(key, live.context)]);
    assert.ok(results.some((result) => result.kind === "completed"));
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === `/issues/${id}.json`).length, 1);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE concurrent");
  });
}
liveTest("LIVE-E09", "送信前の破棄はキューだけを除去しremoteを変更しない", async (live) => {
  const id = await live.createIssue();
  const before = await live.readIssue(id);
  const key = await live.queueTicket(id, { subject: "LIVE-E09 discard" });
  assert.strictEqual(await commitOfflineDiscardAsync(prepareOfflineDiscard(key, live.scope)), "discarded");
  assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(id), false);
  assert.strictEqual((await live.readIssue(id)).ticket.subject, before.ticket.subject);
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
});
liveTest("LIVE-E10", "結果不明の項目を中止してもremoteの適用済み変更は維持する", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-E10 abandoned" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  assert.strictEqual((await live.engine().syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual(await commitOfflineAbandonAsync(prepareOfflineAbandon(key, live.scope)), "abandoned");
  const result = await live.engine().syncAll(live.context);
  assert.strictEqual(result.plan.length, 0);
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-E10 abandoned");
});
const dashboard = (live: LiveFixture) => {
  const messages: string[] = [];
  const service = new DashboardUnsyncedService({
    context: {
      store: new DashboardStateStore(), notifySuccess: () => messages.push("success"),
      notifyError: () => messages.push("error"), notifyToast: () => undefined,
      notifyOperationStarted: () => undefined, onTicketsRefreshed: () => undefined,
    },
    refreshTicketPresentation: () => undefined, loadComments: async () => undefined,
    syncEngine: live.engine(),
  });
  return { service, messages };
};
liveTest("LIVE-E11", "Dashboard単件同期サービスから本番engineを呼ぶ", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-E11 dashboard" });
  const { service, messages } = dashboard(live);
  await service.handleSyncOne("live-e11", key);
  assert.ok(messages.includes("success"));
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-E11 dashboard");
});
liveTest("LIVE-E12", "Dashboard一括同期サービスから全件を送信する", async (live) => {
  const id = await live.createIssue();
  await live.queueTicket(id, { subject: "LIVE-E12 dashboard all" });
  const { service, messages } = dashboard(live);
  await service.handleSyncAll("live-e12");
  assert.ok(messages.includes("success"));
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-E12 dashboard all");
});
