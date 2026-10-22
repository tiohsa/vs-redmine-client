import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as vscode from "vscode";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { getPrimaryEffectForRevision } from "../../app/syncEffects";
import { getDefaultUploadSpoolStore } from "../../app/ticketSync/uploadSpoolStore";
import {
  getPersistedUploadSpoolReferences, getOfflineSyncQueue,
  initializeOfflineSyncStore, persistAsync,
} from "../../views/offlineSyncStore";
import { liveTest, type LiveFixture } from "./liveFixture";

const failUpload = async (live: LiveFixture) => {
  const file = path.join(live.directory, `frozen-${Date.now()}.bin`);
  const bytes = Buffer.from("original frozen bytes\n日本語");
  fs.writeFileSync(file, bytes);
  const key = await live.queueNewTicket({ attachments: [{ kind: "file", filePath: file, filename: path.basename(file) }] });
  live.proxy.arm({ method: "POST", path: "/uploads.json", mode: "status_before", status: 500 });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const operation = engine.getRepository().getOperation(key, live.scope);
  const effect = operation?.effects?.find((item) => item.kind === "attachment_upload");
  assert.ok(operation && effect && effect.requestSnapshot?.kind === "upload");
  if (effect.requestSnapshot?.kind !== "upload") { throw new Error("upload snapshotがありません。"); }
  const snapshot = effect.requestSnapshot;
  assert.ok(snapshot.spoolFilePath);
  live.proxy.reset();
  return { key, engine, operation, effect, snapshot, file, bytes, spoolPath: snapshot.spoolFilePath };
};

for (const mutation of ["delete", "change"] as const) {
  liveTest(mutation === "delete" ? "LIVE-D01" : "LIVE-D02", `元fileを${mutation}しても保存済みbytesでuploadを復旧する`, async (live) => {
    const item = await failUpload(live);
    if (mutation === "delete") { fs.rmSync(item.file); }
    else { fs.writeFileSync(item.file, "changed source bytes"); }
    const result = await item.engine.resolveEffect({ key: item.key, context: live.context,
      operationId: item.operation.operationId, operationRevision: item.operation.revision,
      attemptGeneration: item.operation.attemptGeneration, effectId: item.effect.effectId,
      expectedEffectState: item.effect.state, resolution: { kind: "retry_effect" },
    });
    assert.notStrictEqual(result.kind, "failed_before_commit");
    assert.strictEqual(createHash("sha256").update(fs.readFileSync(item.spoolPath)).digest("hex"), item.snapshot.contentHash);
    const outcome = await item.engine.syncOne(item.key, live.context);
    assert.strictEqual(outcome.kind, "completed");
    if (outcome.kind !== "completed") { return; }
    const response = await live.request<{ issue: { attachments: Array<{ filename: string; filesize: number }> } }>({
      method: "GET", path: `/issues/${outcome.ticketId}.json`, query: { include: "attachments" },
    });
    assert.strictEqual(response.issue.attachments.find((attachment) => attachment.filename === item.snapshot.filename)?.filesize, item.bytes.length);
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/uploads.json").length, 1);
  });
}
for (const mutation of ["delete", "tamper"] as const) {
  liveTest(mutation === "delete" ? "LIVE-D03" : "LIVE-D04", `spoolを${mutation}した後はremoteへuploadしない`, async (live) => {
    const item = await failUpload(live);
    if (mutation === "delete") { fs.rmSync(item.spoolPath); }
    else { fs.writeFileSync(item.spoolPath, "tampered frozen bytes"); }
    const result = await item.engine.resolveEffect({ key: item.key, context: live.context,
      operationId: item.operation.operationId, operationRevision: item.operation.revision,
      attemptGeneration: item.operation.attemptGeneration, effectId: item.effect.effectId,
      expectedEffectState: item.effect.state, resolution: { kind: "retry_effect" },
    });
    assert.strictEqual(result.kind, "failed_before_commit");
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST").length, 0);
  });
}
liveTest("LIVE-D05", "永続snapshotが参照するspoolをcleanupで削除しない", async (live) => {
  const item = await failUpload(live);
  const spool = getDefaultUploadSpoolStore();
  await spool.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(live.storage));
  assert.ok(fs.existsSync(item.spoolPath));
  assert.strictEqual(await spool.verify(item.snapshot), true);
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST").length, 0);
});
liveTest("LIVE-D06", "存在しないfileは開始checkpointやremote writeを残さない", async (live) => {
  const key = await live.queueNewTicket({ attachments: [{ kind: "file", filePath: path.join(live.directory, "absent.bin") }] });
  assert.strictEqual((await live.engine().syncOne(key, live.context)).kind, "failed_before_commit");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST").length, 0);
});
liveTest("LIVE-D07", "実workspaceStateに保存された旧形式ticketを移行して実同期する", async (live) => {
  const id = await live.createIssue();
  const detail = await live.readIssue(id);
  const storageKey = `redmine.offlineSyncQueue.${encodeURIComponent(live.scope)}`;
  await live.storage.update(storageKey, { version: 2, tickets: [[id, {
    ticketId: id, baseSubject: detail.ticket.subject, baseDescription: detail.ticket.description,
    baseMetadata: live.metadata, metadata: live.metadata, subject: "LIVE-D07 migrated", description: "Legacy migrated",
    connectionScope: live.scope, phase: "queued", revision: 1,
  }]], comments: [], newTickets: [] });
  initializeOfflineSyncStore(live.storage, live.scope);
  await persistAsync(live.scope);
  const result = await live.engine().syncOne({ kind: "ticket", ticketId: id }, live.context);
  assert.strictEqual(result.kind, "completed");
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-D07 migrated");
});
liveTest("LIVE-D08", "開始済みwriteの永続復元では自動再送せずunknownにする", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-D08 durable" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  await live.engine().syncOne(key, live.context);
  initializeOfflineSyncStore(live.storage, live.scope);
  const engine = live.engine();
  const operation = engine.getRepository().getOperation(key, live.scope);
  assert.ok(operation);
  assert.strictEqual(getPrimaryEffectForRevision(operation)?.state, "commit_unknown");
  live.proxy.reset();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-D08 durable");
});
liveTest("LIVE-D09", "閉じた新規ticket文書はremote commit後にlocal finalizeを保留する", async (live) => {
  const content = buildTicketEditorContent({ subject: "LIVE-D09 closed document", description: "body", metadata: live.metadata });
  const uri = vscode.Uri.file(path.join(live.directory, "live-d09-closed.md"));
  fs.writeFileSync(uri.fsPath, content);
  const key = await live.queueNewTicket({ subject: "LIVE-D09 closed document", description: "body", content, documentUri: uri.toString() });
  const engine = live.engine();
  const first = await engine.syncOne(key, live.context);
  assert.strictEqual(first.kind, "remote_committed");
  const operation = engine.getRepository().getOperation(key, live.scope);
  assert.ok(operation?.createdRemoteId);
  assert.strictEqual((await live.readIssue(operation.createdRemoteId)).ticket.subject, "LIVE-D09 closed document");
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  const second = await engine.syncOne(key, live.context);
  assert.strictEqual(second.kind, "completed");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/issues.json").length, 1);
  assert.strictEqual(getOfflineSyncQueue(live.scope).newTickets.length, 0);
});
