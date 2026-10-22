import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { getPrimaryEffectForRevision } from "../../app/syncEffects";
import type { SyncOperationKey } from "../../app/ticketSync/syncOperationTypes";
import { addComment } from "../../redmine/comments";
import { addOfflineTicketUpdateAsync, getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { liveTest, type LiveFixture } from "./liveFixture";

const getOperation = (live: LiveFixture, key: SyncOperationKey) =>
  live.engine().getRepository().getOperation(key, live.scope);

const getPrimary = (live: LiveFixture, key: SyncOperationKey) => {
  const operation = getOperation(live, key);
  assert.ok(operation, "operationが永続化されていること");
  const effect = getPrimaryEffectForRevision(operation!);
  assert.ok(effect, "primary effectが永続化されていること");
  return { operation: operation!, effect: effect! };
};

const countHits = (live: LiveFixture, method: string, path: string): number =>
  live.proxy.hits().filter((hit) => hit.method === method && hit.path === path).length;

const waitForForwardedHit = async (live: LiveFixture, method: string, path: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (live.proxy.hits().some((hit) => hit.method === method && hit.path === path && hit.forwarded)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`proxy request was not forwarded: ${method} ${path}`);
};

liveTest("LIVE-R01", "ticket updateの応答消失をcommit_unknownとして原子的に保持する", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, { subject: `LIVE-R01 ${Date.now()}` });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });

  const engine = live.engine();
  const outcome = await engine.syncOne(key, live.context);
  assert.strictEqual(outcome.kind, "commit_unknown");
  const operation = engine.getRepository().getOperation(key, live.scope);
  assert.ok(operation);
  const effect = getPrimaryEffectForRevision(operation!);
  assert.strictEqual(operation!.phase, "commit_unknown");
  assert.strictEqual(effect?.state, "commit_unknown");
  assert.strictEqual(effect?.requestSnapshot?.kind, "ticket_update");
  assert.deepStrictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === path).map((hit) => hit.forwarded), [true]);
  const intent = operation!.intent;
  assert.ok(intent && "subject" in intent);
  assert.strictEqual((await live.readIssue(issueId)).ticket.subject, intent.subject);
});

liveTest("LIVE-R02", "comment createの応答消失後に通常同期で再投稿しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueComment(issueId, `LIVE-R02 ${Date.now()}`);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();

  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual(countHits(live, "PUT", path), 1);
  assert.strictEqual(getPrimary(live, key).effect.state, "commit_unknown");
});

liveTest("LIVE-R03", "comment createのstatus 503も未知として保持し通常再送しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueComment(issueId, `LIVE-R03 ${Date.now()}`);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "status_before", status: 503 });
  const engine = live.engine();

  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.deepStrictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === path).map((hit) => hit.forwarded), [false]);
});

liveTest("LIVE-R04", "known validation failureはremote未送信のfailedとして保持する", async (live) => {
  const issueId = await live.createIssue();
  const initial = await live.readIssue(issueId);
  const key = await live.queueTicket(issueId, { subject: `LIVE-R04 ${Date.now()}` });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "status_before", status: 422 });
  const engine = live.engine();

  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "failed_before_commit");
  assert.strictEqual(getPrimary(live, key).effect.state, "failed");
  assert.deepStrictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT" && hit.path === path).map((hit) => hit.forwarded), [false]);
  assert.strictEqual((await live.readIssue(issueId)).ticket.subject, initial.ticket.subject);
});

liveTest("LIVE-R05", "known non-retryable failureは通常同期で再送しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, { subject: `LIVE-R05 ${Date.now()}` });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "status_before", status: 422 });
  const engine = live.engine();

  await engine.syncOne(key, live.context);
  await engine.syncOne(key, live.context);
  assert.strictEqual(countHits(live, "PUT", path), 1);
});

liveTest("LIVE-R06", "retryable known failureの明示再送は保存済みRequestSnapshotを再利用する", async (live) => {
  const issueId = await live.createIssue();
  const subject = `LIVE-R06 frozen ${Date.now()}`;
  const key = await live.queueTicket(issueId, { subject });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "status_before", status: 500 });
  const engine = live.engine();

  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "failed_before_commit");
  const before = getPrimary(live, key);
  assert.strictEqual(before.effect.state, "failed");
  assert.strictEqual(before.effect.requestSnapshot?.kind, "ticket_update");
  const frozen = structuredClone(before.effect.requestSnapshot);
  live.proxy.reset();
  const retried = await engine.resolveTicketCommitUnknown({
    key: key as Extract<SyncOperationKey, { kind: "ticket" }>,
    context: live.context,
    resolution: { kind: "retry_remote_write" },
  });

  assert.strictEqual(retried.kind, "completed");
  assert.strictEqual(countHits(live, "PUT", path), 1);
  assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(issueId), false);
  assert.strictEqual(frozen?.kind, "ticket_update");
  if (frozen?.kind === "ticket_update") { assert.strictEqual(frozen.request.fields.subject, subject); }
  assert.strictEqual((await live.readIssue(issueId)).ticket.subject, subject);
});

liveTest("LIVE-R07", "primary成功後のGET read-back失敗は再送せず再照合できる", async (live) => {
  const issueId = await live.createIssue();
  const subject = `LIVE-R07 ${Date.now()}`;
  const key = await live.queueTicket(issueId, { subject });
  const getPath = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "GET", path: getPath, mode: "status_before", status: 503, skip: 1 });
  const engine = live.engine();

  const first = await engine.syncOne(key, live.context);
  assert.notStrictEqual(first.kind, "completed");
  assert.strictEqual((await live.readIssue(issueId)).ticket.subject, subject);
  const writeCount = countHits(live, "PUT", getPath);
  live.proxy.reset();
  const recovered = await engine.syncOne(key, live.context);
  assert.strictEqual(recovered.kind, "completed");
  assert.strictEqual(countHits(live, "PUT", getPath), 0);
  assert.strictEqual(writeCount, 1);
});

liveTest("LIVE-R08", "commit_unknownのreconcile中にGET失敗しても状態を保つ", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueComment(issueId, `LIVE-R08 ${Date.now()}`);
  const issuePath = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path: issuePath, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const before = getPrimary(live, key);
  live.proxy.arm({ method: "GET", path: issuePath, mode: "status_before", status: 503 });

  const resolution = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: before.operation.operationId,
    operationRevision: before.operation.intentRevision ?? before.operation.revision,
    attemptGeneration: before.operation.attemptGeneration,
    resolution: { kind: "reconcile_remote" },
  });
  assert.notStrictEqual(resolution.kind, "completed");
  assert.strictEqual(getPrimary(live, key).effect.state, "commit_unknown");
  assert.strictEqual(countHits(live, "PUT", issuePath), 1);
});

liveTest("LIVE-R09", "comment createは正しいremote journalへのmanual linkで完了する", async (live) => {
  const issueId = await live.createIssue();
  const body = `LIVE-R09 ${Date.now()}`;
  const key = await live.queueComment(issueId, body);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const remote = await live.readIssue(issueId);
  const journal = remote.comments.find((comment) => comment.body === body);
  assert.ok(journal);
  const operation = getOperation(live, key)!;

  const linked = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: operation.operationId,
    operationRevision: operation.intentRevision ?? operation.revision,
    attemptGeneration: operation.attemptGeneration,
    resolution: { kind: "link_remote_comment", commentId: journal!.id },
  });
  assert.strictEqual(linked.kind, "completed");
  assert.strictEqual(countHits(live, "PUT", path), 1);
});

liveTest("LIVE-R10", "bodyが一致しないjournalへのmanual linkを拒否する", async (live) => {
  const issueId = await live.createIssue();
  const body = `LIVE-R10 intended ${Date.now()}`;
  const key = await live.queueComment(issueId, body);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const operation = getOperation(live, key)!;

  const rejected = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: operation.operationId,
    operationRevision: operation.intentRevision ?? operation.revision,
    attemptGeneration: operation.attemptGeneration,
    resolution: { kind: "link_remote_comment", commentId: -1 },
  });
  assert.notStrictEqual(rejected.kind, "completed");
  assert.strictEqual(getPrimary(live, key).effect.state, "commit_unknown");
});

liveTest("LIVE-R11", "stale revisionのcomment recovery callbackは永続状態を変更しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueComment(issueId, `LIVE-R11 ${Date.now()}`);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const before = getPrimary(live, key);
  const serialized = getOfflineSyncQueue(live.scope);

  const stale = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: before.operation.operationId,
    operationRevision: (before.operation.intentRevision ?? before.operation.revision) + 1,
    attemptGeneration: before.operation.attemptGeneration,
    resolution: { kind: "reconcile_remote" },
  });
  assert.strictEqual(stale.kind, "failed_before_commit");
  assert.deepStrictEqual(getOfflineSyncQueue(live.scope), serialized);
});

liveTest("LIVE-R12", "stale attemptGenerationのrecovery callbackはremote GETを実行しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueComment(issueId, `LIVE-R12 ${Date.now()}`);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const before = getPrimary(live, key);
  const queueBefore = getOfflineSyncQueue(live.scope);
  live.proxy.reset();

  const stale = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: before.operation.operationId,
    operationRevision: before.operation.intentRevision ?? before.operation.revision,
    attemptGeneration: (before.operation.attemptGeneration ?? 1) + 1,
    resolution: { kind: "reconcile_remote" },
  });
  assert.strictEqual(stale.kind, "failed_before_commit");
  assert.strictEqual(live.proxy.hits().length, 0);
  assert.deepStrictEqual(getOfflineSyncQueue(live.scope), queueBefore);
});

liveTest("LIVE-R13", "新規ticket createの応答消失からmanual linkでremote identityを確定する", async (live) => {
  const subject = `LIVE-R13 ${Date.now()}`;
  const key = await live.queueNewTicket({ subject, description: "live recovery" });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const remoteResponse = await live.request<{ issues: Array<{ id: number; subject: string }> }>({
    method: "GET",
    path: "/issues.json",
    query: { project_id: live.projectId, limit: 100, sort: "id:desc" },
  });
  const created = remoteResponse.issues.find((issue) => issue.subject === subject);
  assert.ok(created);
  const resolved = await engine.resolveTicketCommitUnknown({
    key: key as Extract<typeof key, { kind: "newTicket" }>,
    context: live.context,
    resolution: { kind: "link_created_ticket", ticketId: created!.id },
  });
  assert.strictEqual(resolved.kind, "completed", JSON.stringify(resolved));
  assert.strictEqual(getOfflineSyncQueue(live.scope).newTickets.some((entry) => entry.queueId === key.queueId), false);
  assert.strictEqual(countHits(live, "POST", "/issues.json"), 1);
});

liveTest("LIVE-R14", "ticket update GET failure中に通常同期してもprimaryを再送しない", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, { subject: `LIVE-R14 ${Date.now()}` });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "GET", path, mode: "status_before", status: 503, skip: 1 });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const puts = countHits(live, "PUT", path);
  await engine.syncOne(key, live.context);
  assert.strictEqual(countHits(live, "PUT", path), puts);
});

liveTest("LIVE-R15", "失敗したupload effectの手動retryは凍結済みhashとsizeを維持する", async (live) => {
  const issueId = await live.createIssue();
  const imagePath = `${live.directory}/live-r15.png`;
  fs.writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pHsAAAAASUVORK5CYII=", "base64"));
  const key = await live.queueComment(issueId, `LIVE-R15 image ![img](./live-r15.png) ${Date.now()}`, { baseDir: live.directory });
  live.proxy.arm({ method: "POST", path: "/uploads.json", mode: "status_before", status: 500 });
  const engine = live.engine();
  const outcome = await engine.syncOne(key, live.context);
  assert.notStrictEqual(outcome.kind, "completed");
  const operation = getOperation(live, key);
  assert.ok(operation);
  const upload = operation!.effects?.find((effect) => effect.kind === "image_upload");
  assert.ok(upload?.requestSnapshot?.kind === "upload");
  if (upload?.requestSnapshot?.kind !== "upload") { return; }
  const hash = upload.requestSnapshot.contentHash;
  const size = upload.requestSnapshot.contentSize;
  const beforeHits = countHits(live, "POST", "/uploads.json");
  live.proxy.reset();
  const retried = await engine.resolveEffect({
    key,
    operationId: operation!.operationId,
    operationRevision: operation!.intentRevision ?? operation!.revision,
    attemptGeneration: operation!.attemptGeneration,
    effectId: upload.effectId,
    expectedEffectState: upload.state,
    context: live.context,
    resolution: { kind: "retry_effect" },
  });
  assert.notStrictEqual(retried.kind, "failed_before_commit");
  assert.strictEqual(countHits(live, "POST", "/uploads.json"), 1);
  const after = getOperation(live, key)?.effects?.find((effect) => effect.effectId === upload.effectId);
  assert.ok(after?.requestSnapshot?.kind === "upload");
  if (after?.requestSnapshot?.kind === "upload") {
    assert.strictEqual(after.requestSnapshot.contentHash, hash);
    assert.strictEqual(after.requestSnapshot.contentSize, size);
  }
  assert.strictEqual(beforeHits, 1);
});

liveTest("LIVE-R16", "Memento保存失敗時はprimary remote write前に停止する", async (live) => {
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, { subject: `LIVE-R16 ${Date.now()}` });
  const storage = live.storage as typeof live.storage & { update: typeof live.storage.update };
  const originalUpdate = storage.update.bind(storage);
  storage.update = async () => { throw new Error("injected live fixture persistence failure"); };
  try {
    const outcome = await live.engine().syncOne(key, live.context);
    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(countHits(live, "PUT", `/issues/${issueId}.json`), 0);
  } finally {
    storage.update = originalUpdate;
  }
});

liveTest("LIVE-R17", "comment updateの応答消失後は通常同期で再送しない", async (live) => {
  const issueId = await live.createIssue();
  const oldBody = `LIVE-R17 initial ${Date.now()}`;
  await live.run(() => addComment(issueId, oldBody));
  const journal = (await live.readIssue(issueId)).comments.find((comment) => comment.body === oldBody);
  assert.ok(journal);
  const key = await live.queueComment(issueId, `LIVE-R17 updated ${Date.now()}`, {
    commentId: journal!.id,
    baseBody: oldBody,
  });
  const path = `/journals/${journal!.id}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();

  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  assert.strictEqual(countHits(live, "PUT", path), 1);
  assert.strictEqual(getPrimary(live, key).effect.state, "commit_unknown");
});

liveTest("LIVE-R18", "comment createの明示retryはfrozen request notesを維持する", async (live) => {
  const issueId = await live.createIssue();
  const body = `LIVE-R18 frozen body ${Date.now()}`;
  const key = await live.queueComment(issueId, body);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "status_before", status: 500 });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "failed_before_commit");
  const first = getPrimary(live, key);
  assert.strictEqual(first.effect.requestSnapshot?.kind, "comment_create");
  const frozen = structuredClone(first.effect.requestSnapshot);
  live.proxy.reset();

  assert.strictEqual((await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    resolution: { kind: "retry_remote_write" },
  })).kind, "completed");
  assert.strictEqual(getOfflineSyncQueue(live.scope).comments.some((entry) => entry.operationId === key.operationId), false);
  assert.strictEqual(frozen?.kind, "comment_create");
  if (frozen?.kind === "comment_create") { assert.strictEqual(frozen.request.notes, body); }
  assert.strictEqual((await live.readIssue(issueId)).comments.filter((comment) => comment.body === body).length, 1);
  assert.strictEqual(countHits(live, "PUT", path), 1);
});

liveTest("LIVE-R19", "unknown解決時に追加されたnextIntentを完了後も保持する", async (live) => {
  const issueId = await live.createIssue();
  const firstBody = `LIVE-R19 first ${Date.now()}`;
  const nextBody = `LIVE-R19 next ${Date.now()}`;
  const key = await live.queueComment(issueId, firstBody);
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const original = getOperation(live, key)!;
  await live.queueComment(issueId, nextBody, {
    operationId: original.operationId,
    baseBody: firstBody,
  });
  const remote = await live.readIssue(issueId);
  const journal = remote.comments.find((comment) => comment.body === firstBody);
  assert.ok(journal);

  const resolved = await engine.resolveCommentCommitUnknown({
    key: key as Extract<typeof key, { kind: "comment" }>,
    context: live.context,
    operationId: original.operationId,
    operationRevision: original.intentRevision ?? original.revision,
    attemptGeneration: original.attemptGeneration,
    resolution: { kind: "link_remote_comment", commentId: journal!.id },
  });
  assert.strictEqual(resolved.kind, "completed");
  const promoted = getOfflineSyncQueue(live.scope).comments.find((entry) => entry.operationId === original.operationId);
  assert.ok(promoted);
  assert.strictEqual(promoted!.body, nextBody);
  assert.ok((promoted!.intentRevision ?? promoted!.revision ?? 0) > (original.intentRevision ?? original.revision));
  assert.strictEqual(countHits(live, "PUT", path), 1);
});

liveTest("LIVE-R20", "primary commit checkpointの保存失敗をcommit_unknownで回復可能にする", async (live) => {
  const issueId = await live.createIssue();
  const subject = `LIVE-R20 ${Date.now()}`;
  const key = await live.queueTicket(issueId, { subject });
  const path = `/issues/${issueId}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "delay_after", delayMs: 750 });
  const engine = live.engine();
  const pendingSync = engine.syncOne(key, live.context);
  await waitForForwardedHit(live, "PUT", path);

  const storage = live.storage as typeof live.storage & { update: typeof live.storage.update };
  const originalUpdate = storage.update.bind(storage);
  let failNextUpdate = true;
  storage.update = async (key, value) => {
    if (failNextUpdate) {
      failNextUpdate = false;
      throw new Error("injected primary commit checkpoint failure");
    }
    return originalUpdate(key, value);
  };
  try {
    const outcome = await pendingSync;
    assert.notStrictEqual(outcome.kind, "completed");
    assert.strictEqual((await live.readIssue(issueId)).ticket.subject, subject);
    const { operation, effect } = getPrimary(live, key);
    assert.ok(operation.phase === "commit_unknown" || operation.phase === "remote_write_started");
    assert.ok(effect.state === "commit_unknown" || effect.state === "started");
    assert.strictEqual(effect.requestSnapshot?.kind, "ticket_update");
  } finally {
    storage.update = originalUpdate;
  }
  const firstWriteCount = countHits(live, "PUT", path);
  assert.strictEqual((await engine.syncOne(key, live.context)).kind === "completed", false);
  assert.strictEqual(countHits(live, "PUT", path), firstWriteCount);
});

liveTest("LIVE-R21", "file attachment upload effectをretryし凍結済みidentityを保つ", async (live) => {
  const filePath = `${live.directory}/live-r21.txt`;
  fs.writeFileSync(filePath, `LIVE-R21 attachment ${Date.now()}`);
  const key = await live.queueNewTicket({
    subject: `LIVE-R21 parent ${Date.now()}`,
    description: "file attachment recovery",
    attachments: [{ kind: "file", filePath }],
  });
  live.proxy.arm({ method: "POST", path: "/uploads.json", mode: "status_before", status: 500 });
  const engine = live.engine();
  const firstOutcome = await engine.syncOne(key, live.context);
  assert.notStrictEqual(firstOutcome.kind, "completed");
  const operation = getOperation(live, key);
  assert.ok(operation);
  const upload = operation!.effects?.find((effect) => effect.kind === "attachment_upload");
  assert.ok(upload?.requestSnapshot?.kind === "upload");
  if (upload?.requestSnapshot?.kind !== "upload") { return; }
  const frozen = structuredClone(upload.requestSnapshot);
  live.proxy.reset();

  const retried = await engine.resolveEffect({
    key,
    operationId: operation!.operationId,
    operationRevision: operation!.intentRevision ?? operation!.revision,
    attemptGeneration: operation!.attemptGeneration,
    effectId: upload.effectId,
    expectedEffectState: upload.state,
    context: live.context,
    resolution: { kind: "retry_effect" },
  });
  assert.notStrictEqual(retried.kind, "failed_before_commit");
  const after = getOperation(live, key)?.effects?.find((effect) => effect.effectId === upload.effectId);
  assert.strictEqual(after?.state, "committed");
  assert.deepStrictEqual(after?.requestSnapshot, frozen);
  assert.strictEqual(countHits(live, "POST", "/uploads.json"), 1);
});

liveTest("LIVE-R22", "child ticket作成の一部失敗をeffect単位でretryする", async (live) => {
  const stamp = Date.now();
  const issueId = await live.createIssue();
  const key = await live.queueTicket(issueId, {
    subject: `LIVE-R22 parent ${stamp}`,
    description: "child recovery",
    metadata: { ...live.metadata, children: [`LIVE-R22 child one ${stamp}`, `LIVE-R22 child two ${stamp}`] },
  });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "status_before", status: 500, skip: 1 });
  const engine = live.engine();
  const first = await engine.syncOne(key, live.context);
  assert.notStrictEqual(first.kind, "completed");
  const operation = getOperation(live, key);
  assert.ok(operation);
  const failedChild = operation!.effects?.find((effect) => effect.kind === "child_create" && effect.state === "failed");
  assert.ok(failedChild);
  assert.strictEqual(failedChild!.requestSnapshot?.kind, "child_create");
  live.proxy.reset();

  const retried = await engine.resolveEffect({
    key,
    operationId: operation!.operationId,
    operationRevision: operation!.intentRevision ?? operation!.revision,
    attemptGeneration: operation!.attemptGeneration,
    effectId: failedChild!.effectId,
    expectedEffectState: "failed",
    context: live.context,
    resolution: { kind: "retry_effect" },
  });
  assert.notStrictEqual(retried.kind, "failed_before_commit");
  const after = engine.getRepository().getOperation(key, live.scope)?.effects?.find((effect) => effect.effectId === failedChild!.effectId);
  assert.strictEqual(after?.state, "committed");
  assert.strictEqual(after?.remoteId !== undefined, true);
});



// 補償は実RedmineのDELETEと、その応答消失を通して検証する。
liveTest("LIVE-R23", "子作成の既知失敗で親子を補償し新しいattemptで再作成する", async (live) => {
  const subject = `LIVE-R23 ${Date.now()}`;
  const key = await live.queueNewTicket({ subject, metadata: { ...live.metadata, children: ["one", "two"] } });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "status_before", status: 500, skip: 2 });
  const engine = live.engine();
  assert.notStrictEqual((await engine.syncOne(key, live.context)).kind, "completed");
  const operation = getOperation(live, key);
  assert.ok(operation);
  assert.strictEqual(operation.attemptGeneration, 2);
  assert.strictEqual(operation.createdRemoteId, undefined);
  const deletedIds = live.proxy.hits().filter((hit) => hit.method === "DELETE" && hit.forwarded)
    .map((hit) => Number(/^\/issues\/(\d+)\.json$/.exec(hit.path)?.[1]));
  assert.strictEqual(deletedIds.length, 2);
  for (const id of deletedIds) { await assert.rejects(live.readIssue(id), /404/); }
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "completed");
  const list = await live.request<{ issues: Array<{ subject: string }> }>({ method: "GET", path: "/issues.json",
    query: { project_id: live.projectId, limit: 100 } });
  assert.strictEqual(list.issues.filter((issue) => issue.subject === subject).length, 1);
});

for (const mode of ["drop_before", "drop_after"] as const) {
  liveTest(mode === "drop_before" ? "LIVE-R24" : "LIVE-R25", `親DELETEの${mode}後に実GETで補償を照合する`, async (live) => {
    const key = await live.queueNewTicket({ metadata: { ...live.metadata, children: ["failing child"] } });
    live.proxy.arm({ method: "POST", path: "/issues.json", mode: "status_before", status: 500, skip: 1 });
    live.proxy.arm({ method: "DELETE", path: "/issues/*", mode });
    const engine = live.engine();
    await engine.syncOne(key, live.context);
    const { operation, effect } = getPrimary(live, key);
    assert.strictEqual(effect.state, "compensation_unknown");
    assert.ok(effect.remoteId);
    if (mode === "drop_after") { await assert.rejects(live.readIssue(effect.remoteId), /404/); }
    else { assert.ok(await live.readIssue(effect.remoteId)); }
    const creates = countHits(live, "POST", "/issues.json");
    await engine.syncOne(key, live.context);
    assert.strictEqual(countHits(live, "POST", "/issues.json"), creates);
    const result = await engine.resolveTicketCommitUnknown({ key, context: live.context,
      resolution: { kind: "reconcile_compensation" } });
    assert.strictEqual(result.kind, "queued", JSON.stringify(result));
    await assert.rejects(live.readIssue(effect.remoteId), /404/);
    assert.strictEqual(getOperation(live, key)?.attemptGeneration, (operation.attemptGeneration ?? 1) + 1);
  });
}

liveTest("LIVE-R26", "補償対象のidentityが変わった場合はDELETEを拒否する", async (live) => {
  const key = await live.queueNewTicket({ metadata: { ...live.metadata, children: ["failing"] } });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "status_before", status: 500, skip: 1 });
  live.proxy.arm({ method: "DELETE", path: "/issues/*", mode: "drop_before" });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const { effect } = getPrimary(live, key);
  assert.ok(effect.remoteId);
  await live.request({ method: "PUT", path: `/issues/${effect.remoteId}.json`, body: { issue: { subject: "changed remotely" } } });
  live.proxy.reset();
  const result = await engine.resolveTicketCommitUnknown({ key, context: live.context,
    resolution: { kind: "reconcile_compensation" } });
  assert.strictEqual(result.kind, "failed_before_commit");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "DELETE").length, 0);
  assert.strictEqual((await live.readIssue(effect.remoteId)).ticket.subject, "changed remotely");
});

liveTest("LIVE-R27", "応答を失った子作成は実在する子を検証して紐付ける", async (live) => {
  const id = await live.createIssue();
  const subject = `LIVE-R27 child ${Date.now()}`;
  const key = await live.queueTicket(id, { metadata: { ...live.metadata, children: [subject] } });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "drop_after" });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const operation = getOperation(live, key);
  const effect = operation?.effects?.find((item) => item.kind === "child_create");
  assert.ok(operation && effect);
  assert.strictEqual(effect.state, "commit_unknown");
  const children = (await live.request<{ issues: Array<{ id: number; subject: string }> }>({
    method: "GET", path: "/issues.json", query: { project_id: live.projectId, parent_id: id, limit: 100 },
  })).issues;
  const child = children.find((item) => item.subject === subject);
  assert.ok(child);
  const result = await engine.resolveEffect({ key, context: live.context,
    operationId: operation.operationId, operationRevision: operation.revision,
    attemptGeneration: operation.attemptGeneration, effectId: effect.effectId,
    expectedEffectState: effect.state, resolution: { kind: "link_remote_child", remoteId: child.id } });
  assert.notStrictEqual(result.kind, "failed_before_commit", JSON.stringify(result));
  const final = await engine.syncOne(key, live.context);
  assert.ok(final.kind === "completed" || final.kind === "no_change", JSON.stringify(final));
  assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(id), false);
  assert.strictEqual(countHits(live, "POST", "/issues.json"), 1);
});

liveTest("LIVE-R28", "結果不明uploadの明示retryは同じbytesを送り親を一度だけ作る", async (live) => {
  const filePath = `${live.directory}/unknown-upload.bin`;
  fs.writeFileSync(filePath, "unknown frozen upload");
  const key = await live.queueNewTicket({ attachments: [{ kind: "file", filePath }] });
  live.proxy.arm({ method: "POST", path: "/uploads.json", mode: "drop_after" });
  const engine = live.engine();
  await engine.syncOne(key, live.context);
  const operation = getOperation(live, key);
  const effect = operation?.effects?.find((item) => item.kind === "attachment_upload");
  assert.ok(operation && effect);
  assert.strictEqual(effect.state, "commit_unknown");
  const before = countHits(live, "POST", "/uploads.json");
  await engine.syncOne(key, live.context);
  assert.strictEqual(countHits(live, "POST", "/uploads.json"), before);
  const result = await engine.resolveEffect({ key, context: live.context,
    operationId: operation.operationId, operationRevision: operation.revision,
    attemptGeneration: operation.attemptGeneration, effectId: effect.effectId,
    expectedEffectState: effect.state, resolution: { kind: "retry_effect" } });
  assert.notStrictEqual(result.kind, "failed_before_commit", JSON.stringify(result));
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "completed");
  const uploads = live.proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/uploads.json");
  assert.strictEqual(uploads.length, 2);
  assert.strictEqual(uploads[0].bodyHash, uploads[1].bodyHash);
  assert.strictEqual(countHits(live, "POST", "/issues.json"), 1);
});

liveTest("LIVE-R29", "comment updateの結果不明を実GETだけで確定する", async (live) => {
  const id = await live.createIssue();
  await live.run(() => addComment(id, "LIVE-R29 base"));
  const comment = (await live.readIssue(id)).comments.find((item) => item.body === "LIVE-R29 base");
  assert.ok(comment);
  const key = await live.queueComment(id, "LIVE-R29 updated", { commentId: comment.id, baseBody: comment.body });
  const path = `/journals/${comment.id}.json`;
  live.proxy.arm({ method: "PUT", path, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const result = await engine.resolveCommentCommitUnknown({ key, context: live.context, resolution: { kind: "reconcile_remote" } });
  assert.strictEqual(result.kind, "completed", JSON.stringify(result));
  assert.strictEqual(countHits(live, "PUT", path), 1);
  assert.strictEqual((await live.readIssue(id)).comments.find((item) => item.id === comment.id)?.body, "LIVE-R29 updated");
});


liveTest("LIVE-R30", "unknown処理中に追加した添付をnextIntent昇格後に送信する", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-R30 first" });
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const operation = getOperation(live, key);
  assert.ok(operation?.intent && "subject" in operation.intent);
  const filePath = `${live.directory}/next-intent-attachment.txt`;
  fs.writeFileSync(filePath, "next intent attachment");
  const detail = await live.readIssue(id);
  const baseMetadata = live.metadata;
  await addOfflineTicketUpdateAsync(id, { ticketId: id, baseSubject: detail.ticket.subject,
    baseDescription: detail.ticket.description ?? "", baseMetadata, metadata: baseMetadata,
    subject: "LIVE-R30 next", description: detail.ticket.description ?? "",
    attachments: [{ kind: "file", filePath }],
  }, live.scope);
  assert.strictEqual((await engine.resolveTicketCommitUnknown({ key, context: live.context,
    resolution: { kind: "reconcile_remote" } })).kind, "completed");
  assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.get(id)?.attachments?.length, 1);
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "completed");
  const remote = await live.request<{ issue: { attachments: Array<{ filename: string }> } }>({
    method: "GET", path: `/issues/${id}.json`, query: { include: "attachments" },
  });
  assert.ok(remote.issue.attachments.some((item) => item.filename === "next-intent-attachment.txt"));
  assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-R30 next");
});


liveTest("LIVE-R31", "実Redmineの422 validation errorを再送不可の失敗として保持する", async (live) => {
  const key = await live.queueNewTicket({ subject: "x".repeat(300) });
  const engine = live.engine();
  const result = await engine.syncOne(key, live.context);
  assert.strictEqual(result.kind, "failed_before_commit", JSON.stringify(result));
  const { effect } = getPrimary(live, key);
  assert.strictEqual(effect.state, "failed");
  assert.strictEqual(effect.failure?.disposition, "non_retriable");
  assert.ok(live.proxy.hits().some((hit) => hit.method === "POST" && hit.forwarded && hit.status === 422));
  const writes = countHits(live, "POST", "/issues.json");
  await engine.syncOne(key, live.context);
  await engine.resolveTicketCommitUnknown({ key, context: live.context, resolution: { kind: "retry_remote_write" } });
  assert.strictEqual(countHits(live, "POST", "/issues.json"), writes);
});

liveTest("LIVE-R32", "実PUT成功後のtimeoutから再送せず照合で復旧する", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-R32 timeout committed" });
  const configuration = vscode.workspace.getConfiguration("redmine-client");
  const previous = configuration.inspect<number>("requestTimeoutMs")?.workspaceValue;
  await configuration.update("requestTimeoutMs", 1000, vscode.ConfigurationTarget.Workspace);
  try {
    live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "delay_after", delayMs: 2500 });
    const engine = live.engine();
    assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-R32 timeout committed");
    assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
    assert.strictEqual((await engine.resolveTicketCommitUnknown({ key, context: live.context,
      resolution: { kind: "reconcile_remote" } })).kind, "completed");
    assert.strictEqual(countHits(live, "PUT", `/issues/${id}.json`), 1);
  } finally { await configuration.update("requestTimeoutMs", previous, vscode.ConfigurationTarget.Workspace); }
});

for (const checkpoint of ["local_finalize_pending", "complete"] as const) {
  liveTest(checkpoint === "complete" ? "LIVE-R34" : "LIVE-R33", `${checkpoint}のMemento保存失敗からwriteを再送せず再開する`, async (live) => {
    const id = await live.createIssue();
    const key = await live.queueTicket(id, { subject: `checkpoint ${checkpoint}` });
    const originalUpdate = live.storage.update.bind(live.storage);
    const storageKey = `redmine.offlineSyncQueue.${encodeURIComponent(live.scope)}`;
    let injected = false;
    live.storage.update = async (key, value) => {
      const serialized = JSON.stringify(value);
      if (!injected && key === storageKey && serialized?.includes(checkpoint === "complete"
        ? '"operations":[]' : '"phase":"local_finalize_pending"')) {
        injected = true;
        throw new Error(`injected ${checkpoint} persistence failure`);
      }
      return originalUpdate(key, value);
    };
    const engine = live.engine();
    try {
      assert.strictEqual((await engine.syncOne(key, live.context)).kind, "remote_committed");
      assert.ok(injected);
      assert.ok(getOfflineSyncQueue(live.scope).tickets.has(id));
      assert.strictEqual((await live.readIssue(id)).ticket.subject, `checkpoint ${checkpoint}`);
    } finally { live.storage.update = originalUpdate; }
    assert.strictEqual((await engine.syncOne(key, live.context)).kind, "completed");
    assert.strictEqual(countHits(live, "PUT", `/issues/${id}.json`), 1);
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(id), false);
  });
}


liveTest("LIVE-R35", "手動identity確定の保存失敗でもOperationとPrimaryのunknownを原子的に維持する", async (live) => {
  const subject = `LIVE-R35 ${Date.now()}`;
  const key = await live.queueNewTicket({ subject });
  live.proxy.arm({ method: "POST", path: "/issues.json", mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const remote = await live.request<{ issues: Array<{ id: number; subject: string }> }>({
    method: "GET", path: "/issues.json", query: { project_id: live.projectId, limit: 100 },
  });
  const created = remote.issues.find((item) => item.subject === subject);
  assert.ok(created);
  const originalUpdate = live.storage.update.bind(live.storage);
  live.storage.update = async () => { throw new Error("injected manual identity checkpoint failure"); };
  try {
    const result = await engine.resolveTicketCommitUnknown({ key, context: live.context,
      resolution: { kind: "link_created_ticket", ticketId: created.id } });
    assert.notStrictEqual(result.kind, "completed");
    const { operation, effect } = getPrimary(live, key);
    assert.strictEqual(operation.phase, "commit_unknown");
    assert.strictEqual(effect.state, "commit_unknown");
  } finally { live.storage.update = originalUpdate; }
  assert.strictEqual((await engine.resolveTicketCommitUnknown({ key, context: live.context,
    resolution: { kind: "link_created_ticket", ticketId: created.id } })).kind, "completed");
  assert.strictEqual(countHits(live, "POST", "/issues.json"), 1);
});
