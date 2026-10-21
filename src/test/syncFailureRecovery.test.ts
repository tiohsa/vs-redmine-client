import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { applyQueuedCommentUpdate } from "../views/commentSaveSync";
import { createSyncEngine, type SyncEngineKey } from "../app/syncEngine";
import { getAttemptGeneration, getPrimaryEffectForRevision } from "../app/syncEffects";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import type { IssueDetailResult, IssueUpdateInput } from "../redmine/issues";
import type { UploadToken } from "../redmine/types";
import {
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/failure-recovery/";
const context = { connectionScope: SCOPE };
const ticketKey = { kind: "ticket" as const, ticketId: 501 };
const metadata = { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] };
const upload: UploadToken = { token: "saved-token", filename: "image.png", content_type: "image/png" };
const detail = (description = "Description", subject = "Parent"): IssueDetailResult => ({
  ticket: { id: 501, projectId: 1, subject, description, trackerId: 1, trackerName: "Bug", statusId: 1, statusName: "New", priorityId: 1, priorityName: "Normal" },
  comments: [],
});
const queueTicket = (overrides: Partial<OfflineTicketUpdate> = {}) => addOfflineTicketUpdateAsync(501, {
  ticketId: 501, subject: "Changed", description: "Description", metadata,
  baseSubject: "Parent", baseDescription: "Description", baseMetadata: metadata, ...overrides,
}, SCOPE);

const withWarningChoice = async <T>(label: string, action: () => Promise<T>): Promise<T> => {
  const original = vscode.window.showWarningMessage;
  vscode.window.showWarningMessage = async <I extends string | vscode.MessageItem>(
    _message: string, ...items: Array<I | vscode.MessageOptions>
  ): Promise<I | undefined> => items.find((item): item is I =>
    (typeof item === "string" ? item : typeof item === "object" && "title" in item ? item.title : "") === label);
  try { return await action(); }
  finally { vscode.window.showWarningMessage = original; }
};

suite("同期失敗後の明示復旧", () => {
  let memento: TestMemento;
  let directory: string;
  let previousScope: string;

  setup(() => {
    previousScope = getCurrentConnectionScope();
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-failure-recovery-"));
  });
  teardown(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    initializeOfflineSyncStore(createTestMemento(), previousScope);
  });

  test("500後の親更新再送でも active intent の子チケットを作成する", async () => {
    await queueTicket({ metadata: { ...metadata, children: ["Child A", "Child A"] } });
    let writes = 0;
    const children: Array<{ subject: string; projectId: number; parentId?: number }> = [];
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => detail("Description", writes > 1 ? "Changed" : "Parent"),
      resolveMetadataForUpdate: async () => ({}),
      updateIssue: async () => { if (++writes === 1) { throw new Error("HTTP 500"); } },
      createIssue: async (input: { subject: string; projectId: number; parentId?: number }) => {
        children.push(input); return 900;
      },
    } });
    assert.strictEqual((await engine.syncOne(ticketKey, context)).kind, "failed_before_commit");
    initializeOfflineSyncStore(memento, SCOPE);
    const outcome = await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "retry_remote_write" } });
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(writes, 2);
    assert.deepStrictEqual(children.map(({ subject, projectId, parentId }) => ({ subject, projectId, parentId })), [
      { subject: "Child A", projectId: 1, parentId: 501 },
    ]);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(501), false);
  });

  test("再送後の子作成が失敗したらキューを保持し、子だけを明示再試行する", async () => {
    await queueTicket({ metadata: { ...metadata, children: ["Child A"] } });
    let writes = 0;
    let creates = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => detail("Description", "Changed"),
      resolveMetadataForUpdate: async () => ({}),
      updateIssue: async () => { if (++writes === 1) { throw new Error("HTTP 500"); } },
      createIssue: async () => { if (++creates === 1) { throw new Error("HTTP 500"); } return 900; },
    } });
    await engine.syncOne(ticketKey, context);
    const retried = await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "retry_remote_write" } });
    assert.notStrictEqual(retried.kind, "completed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(501), true);
    const item = engine.getRecoveryItems(ticketKey, context).find((entry) => entry.effectKind === "child_create");
    assert.ok(item);
    const recovered = await engine.resolveEffect({
      key: ticketKey, context, operationId: item.operationId, operationRevision: item.operationRevision,
      attemptGeneration: item.attemptGeneration, effectId: item.effectId, expectedEffectState: item.state,
      resolution: { kind: "retry_effect" },
    });
    assert.strictEqual(recovered.kind, "completed");
    assert.strictEqual(writes, 2, "親更新は追加再送しない");
    assert.strictEqual(creates, 2);
  });

  test("画像変換後の送信本文を再起動後に照合し、不一致は拒否する", async () => {
    fs.writeFileSync(path.join(directory, "image.png"), "frozen image bytes");
    await queueTicket({ description: "![img](./image.png)", baseDir: directory });
    let submitted: IssueUpdateInput | undefined;
    let remote = detail();
    let uploads = 0;
    let writes = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => remote,
      updateIssue: async (request: IssueUpdateInput) => { submitted = request; writes++; throw new Error("ETIMEDOUT"); },
      uploadFile: async () => { uploads++; return upload; },
    } });
    assert.strictEqual((await engine.syncOne(ticketKey, context)).kind, "commit_unknown");
    assert.ok(submitted);
    assert.strictEqual(submitted.fields.description, "![img](image.png)");
    initializeOfflineSyncStore(memento, SCOPE);
    assert.strictEqual((await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "reconcile_remote" } })).kind, "commit_unknown");
    remote = detail(submitted.fields.description, submitted.fields.subject);
    const outcome = await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "reconcile_remote" } });
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(writes, 1);
    assert.strictEqual(uploads, 1);
  });

  for (const imagePath of ["./image.png", "./images/image.png"]) {
    test(`spoolから画像を復旧した後、元画像なしで親更新を再開できる (${imagePath})`, async () => {
      const file = path.join(directory, imagePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "frozen image bytes");
      // basename の fallback 保存先も、元画像消失後に同じ Effect へ結び付ける。
      await queueTicket({ description: "![img](./image.png)", baseDir: directory });
      let uploads = 0;
      let submitted: IssueUpdateInput | undefined;
      const engine = createSyncEngine({ tickets: {
        getIssueDetail: async () => detail(submitted?.fields.description, submitted?.fields.subject),
        updateIssue: async (request: IssueUpdateInput) => { submitted = request; },
        uploadFile: async (spool: string) => {
          assert.strictEqual(fs.readFileSync(spool, "utf8"), "frozen image bytes");
          if (++uploads === 1) { throw new Error("HTTP 500"); }
          return upload;
        },
      } });
      assert.strictEqual((await engine.syncOne(ticketKey, context)).kind, "failed_before_commit");
      fs.unlinkSync(file);
      initializeOfflineSyncStore(memento, SCOPE);
      const item = engine.getRecoveryItems(ticketKey, context).find((entry) => entry.effectKind === "image_upload");
      assert.ok(item);
      await engine.resolveEffect({
        key: ticketKey, context, operationId: item.operationId, operationRevision: item.operationRevision,
        attemptGeneration: item.attemptGeneration, effectId: item.effectId, expectedEffectState: item.state,
        resolution: { kind: "retry_effect" },
      });
      assert.strictEqual((await engine.syncOne(ticketKey, context)).kind, "completed");
      assert.strictEqual(submitted?.fields.description, "![img](image.png)");
      assert.deepStrictEqual(submitted?.fields.uploads, [upload]);
      assert.strictEqual(uploads, 2);
    });
  }

  for (const kind of ["comment_create", "comment_update"] as const) {
    test(`${kind}: 500後にUIから保存済みの本文・画像を一度だけ再送できる`, async () => {
      const file = path.join(directory, "image.png");
      fs.writeFileSync(file, "frozen comment image");
      const documentUri = vscode.Uri.file(path.join(directory, "ticket.md")).toString();
      const key: Extract<SyncEngineKey, { kind: "comment" }> = {
        kind: "comment", ticketId: 501, commentId: kind === "comment_update" ? 701 : undefined, documentUri,
      };
      await addOfflineCommentUpdateAsync({
        ticketId: 501, commentId: key.commentId, body: "Comment ![img](./image.png)", documentUri,
        baseBody: key.commentId ? "Old comment" : undefined,
        lastKnownRemoteUpdatedAt: key.commentId ? "old" : undefined,
      }, SCOPE);
      const sent: Array<{ id: number; notes: string; uploads?: UploadToken[] }> = [];
      let uploads = 0;
      let links = 0;
      let remoteBody = "Old comment";
      const remoteTime = "old";
      const send = async (id: number, notes: string, tokens?: UploadToken[]) => {
        sent.push({ id, notes, uploads: tokens });
        if (sent.length === 1) { throw new Error("HTTP 500"); }
        remoteBody = notes;
      };
      const engine = createSyncEngine({ comments: {
        addComment: send,
        updateComment: send,
        updateIssue: async () => { links++; },
        uploadFile: async () => { uploads++; return { token: upload.token, filename: upload.filename, contentType: upload.content_type }; },
        getCurrentUserId: async () => 7,
        getIssueDetail: async () => ({ ...detail(), comments: [{
          id: 701, ticketId: 501, authorId: 7, authorName: "Author", body: remoteBody,
          updatedAt: remoteTime, editableByCurrentUser: true,
        }] }),
      } });
      assert.strictEqual((await engine.syncOne(key, context)).kind, "failed_before_commit");
      assert.strictEqual(sent.length, 1);
      fs.unlinkSync(file);
      initializeOfflineSyncStore(memento, SCOPE);
      const op = engine.getRepository().getOperation(key, SCOPE);
      assert.ok(op);
      const frozen = getPrimaryEffectForRevision(op)?.requestSnapshot;
      assert.ok(frozen?.kind === kind);
      const outcome = await withWarningChoice(vscode.l10n.t("Retry remote write"), () =>
        runWithConnectionScope(SCOPE, () => syncUnsyncedFile({ syncKey: key }, { createSyncEngine: () => engine })));
      assert.strictEqual(outcome?.status, "success");
      assert.strictEqual(outcome.id, 701, "GETで確認したjournal identityを確定する");
      assert.deepStrictEqual(sent[1], sent[0]);
      assert.strictEqual(sent[0].notes, "Comment ![img](image.png)");
      assert.strictEqual(uploads, 1);
      assert.strictEqual(links, kind === "comment_update" ? 1 : 0);
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
      assert.strictEqual((await engine.syncOne(key, context)).kind, "failed_before_commit");
      assert.strictEqual(sent.length, 2);
    });

    for (const failure of ["HTTP 403", "ETIMEDOUT"] as const) {
      test(`${kind}: ${failure} の再送をUIとAPIの両方で拒否する`, async () => {
        const key: Extract<SyncEngineKey, { kind: "comment" }> = { kind: "comment", ticketId: 501, commentId: kind === "comment_update" ? 701 : undefined };
        await addOfflineCommentUpdateAsync({ ticketId: 501, commentId: key.commentId, body: "New comment" }, SCOPE);
        let writes = 0;
        const fail = async () => { writes++; throw new Error(failure); };
        const engine = createSyncEngine({ comments: { addComment: fail, updateComment: fail } });
        await engine.syncOne(key, context);
        const before = JSON.stringify(getOfflineSyncQueue(SCOPE));
        assert.ok(engine.getRecoveryItems(key, context).every((item) => !item.allowedActions.includes("retry_remote_write")));
        await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
        assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE)), before);
        assert.strictEqual(writes, 1);
      });
    }
  }

  test("コメント再送はsnapshot欠損・古いrevision・古いAttemptを拒否する", async () => {
    const key = { kind: "comment" as const, ticketId: 501 };
    await addOfflineCommentUpdateAsync({ ticketId: 501, body: "Comment" }, SCOPE);
    let writes = 0;
    const engine = createSyncEngine({ comments: { addComment: async () => { writes++; throw new Error("HTTP 500"); } } });
    await engine.syncOne(key, context);
    const repository = engine.getRepository();
    const op = repository.getOperation(key, SCOPE);
    assert.ok(op);
    for (const identity of [{ operationRevision: 99 }, { attemptGeneration: 99 }]) {
      const before = JSON.stringify(getOfflineSyncQueue(SCOPE));
      await engine.resolveCommentCommitUnknown({ key, context, ...identity, resolution: { kind: "retry_remote_write" } });
      assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE)), before);
    }
    op.effects = op.effects?.map((effect) => ({ ...effect, requestSnapshot: undefined }));
    await repository.saveOperation(op, SCOPE);
    const before = JSON.stringify(getOfflineSyncQueue(SCOPE));
    assert.ok(engine.getRecoveryItems(key, context).every((item) => !item.allowedActions.includes("retry_remote_write")));
    await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
    assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE)), before);
    assert.strictEqual(writes, 1);
  });

  test("コメント再送中の後続編集を保持し、同時再送を一回にまとめる", async () => {
    const key = { kind: "comment" as const, ticketId: 501, commentId: 701 };
    await addOfflineCommentUpdateAsync({ ticketId: 501, commentId: 701, body: "Original comment", baseBody: "Old comment" }, SCOPE);
    let releaseWrite: (() => void) | undefined;
    let enteredWrite: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
    let writes = 0;
    const engine = createSyncEngine({ comments: {
      updateComment: async (_id, body) => {
        writes++;
        assert.strictEqual(body, "Original comment");
        if (writes === 1) { throw new Error("HTTP 500"); }
        enteredWrite?.();
        await release;
      },
      getIssueDetail: async () => ({ ...detail(), comments: [{
        id: 701, ticketId: 501, authorId: 7, authorName: "Author", body: writes > 1 ? "Original comment" : "Old comment", editableByCurrentUser: true,
      }] }),
    } });
    await engine.syncOne(key, context);
    const retry = () => engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
    const first = retry();
    await entered;
    const second = retry();
    try {
      await addOfflineCommentUpdateAsync({ ticketId: 501, commentId: 701, body: "Later edit" }, SCOPE);
    } finally { releaseWrite?.(); }
    assert.strictEqual((await first).kind, "completed");
    await second;
    assert.strictEqual(writes, 2, "最初の失敗と明示再送以外に書き込まない");
    const remaining = getOfflineSyncQueue(SCOPE).comments;
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].body, "Later edit");
    assert.strictEqual(remaining[0].phase, "queued");
    assert.strictEqual(remaining[0].revision, 2);
  });

  test("更新の照合はmetadataの表示名を再解決せず保存済みIDとクリア値を検証する", async () => {
    await queueTicket({ metadata: { ...metadata, tracker: "2", due_date: "", assignee: "" } });
    let remote = detail("Description", "Changed");
    let writes = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => remote,
      resolveMetadataForUpdate: async () => ({ trackerId: 2, assignedToId: "", dueDate: null }),
      updateIssue: async () => { writes++; throw new Error("ETIMEDOUT"); },
    } });
    assert.strictEqual((await engine.syncOne(ticketKey, context)).kind, "commit_unknown");
    assert.strictEqual((await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "reconcile_remote" } })).kind, "commit_unknown");
    remote = { ...remote, ticket: { ...remote.ticket, trackerId: 2, trackerName: "Feature" } };
    assert.strictEqual((await engine.resolveTicketCommitUnknown({ key: ticketKey, context, resolution: { kind: "reconcile_remote" } })).kind, "completed");
    assert.strictEqual(writes, 1);
  });

  test("子作成失敗・親削除timeout後、UIの補償操作から次のAttemptへ復旧する", async () => {
    const queued = await addOfflineNewTicketAsync({
      content: buildTicketEditorContent({ subject: "Parent", description: "Description", metadata: { ...metadata, children: ["Child A"] }, controlFields: { project_id: 1 } }),
      projectId: 1,
    }, SCOPE);
    const key = { kind: "newTicket" as const, queueId: queued.queueId };
    let creates = 0;
    let deletes = 0;
    const engine = createSyncEngine({ tickets: {
      resolveMetadataForCreate: async () => ({}),
      createIssue: async (input: { parentId?: number }) => { creates++; if (input.parentId) { throw new Error("HTTP 500"); } return 501; },
      deleteIssue: async () => { if (++deletes === 1) { throw new Error("ETIMEDOUT"); } },
      getIssueDetail: async () => detail(),
    } });
    await engine.syncOne(key, context);
    const before = engine.getRepository().getOperation(key, SCOPE);
    assert.ok(before);
    assert.strictEqual(getPrimaryEffectForRevision(before)?.state, "compensation_unknown");
    assert.ok(engine.getRecoveryItems(key, context).some((item) => item.disposition === "manual_repair_required"));
    initializeOfflineSyncStore(memento, SCOPE);
    const outcome = await withWarningChoice(vscode.l10n.t("Clean up remote write (Reconcile compensation)"), () =>
      runWithConnectionScope(SCOPE, () => syncUnsyncedFile({ syncKey: key }, { createSyncEngine: () => engine })));
    assert.strictEqual(outcome?.status, "queued");
    assert.strictEqual(deletes, 2);
    assert.strictEqual(creates, 2, "補償操作で新しい親・子を作成しない");
    const after = engine.getRepository().getOperation(key, SCOPE);
    assert.ok(after);
    assert.strictEqual(after.phase, "queued");
    assert.strictEqual(getAttemptGeneration(after), getAttemptGeneration(before) + 1);
    assert.strictEqual(after.createdRemoteId, undefined);
  });
  for (const remoteState of ["unavailable", "missing", "changed", "unchanged", "applied"] as const) {
    test(`コメント更新の明示再送前にリモートを検証する: ${remoteState}`, async () => {
      const key = { kind: "comment" as const, ticketId: 501, commentId: 701 };
      await addOfflineCommentUpdateAsync({ ticketId: 501, commentId: 701, body: "New", baseBody: "Old", lastKnownRemoteUpdatedAt: "old" }, SCOPE);
      let writes = 0;
      let retrying = false;
      const engine = createSyncEngine({ comments: {
        updateComment: async () => { if (++writes === 1) { throw new Error("HTTP 500"); } },
        getIssueDetail: async () => {
          if (retrying && remoteState === "unavailable") { throw new Error("GET unavailable"); }
          return { ...detail(), comments: retrying && remoteState === "missing" ? [] : [{
            id: 701, ticketId: 501, authorId: 7, authorName: "Author", editableByCurrentUser: true,
            body: writes > 1 || (retrying && remoteState === "applied") ? "New" : retrying && remoteState === "changed" ? "Other edit" : "Old",
            updatedAt: "old",
          }] };
        },
      } });
      assert.strictEqual((await engine.syncOne(key, context)).kind, "failed_before_commit");
      initializeOfflineSyncStore(memento, SCOPE);
      retrying = true;
      const result = await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
      assert.strictEqual(writes, remoteState === "unchanged" ? 2 : 1);
      assert.strictEqual(result.kind, remoteState === "applied" || remoteState === "unchanged" ? "completed" : remoteState === "changed" ? "conflict" : "failed_before_commit");
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, remoteState === "applied" || remoteState === "unchanged" ? 0 : 1);
    });
  }

  for (const state of ["unavailable", "missing"] as const) {
    test(`初回の競合確認が${state}ならコメントを送信しない`, async () => {
      const key = { kind: "comment" as const, ticketId: 501, commentId: 701 };
      await addOfflineCommentUpdateAsync({ ticketId: 501, commentId: 701, body: "New", baseBody: "Old", lastKnownRemoteUpdatedAt: "old" }, SCOPE);
      let writes = 0;
      const engine = createSyncEngine({ comments: {
        updateComment: async () => { writes++; },
        getIssueDetail: async () => { if (state === "unavailable") { throw new Error("GET failed"); } return detail(); },
      } });
      assert.strictEqual((await engine.syncOne(key, context)).kind, "failed_before_commit");
      assert.strictEqual(writes, 0);
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 1);
    });
  }

  for (const code of [502, 503, 504]) {
    test(`proxy ${code}後のコメント作成は照合して確定し、再送しない`, async () => {
      const key = { kind: "comment" as const, ticketId: 501 };
      await addOfflineCommentUpdateAsync({ ticketId: 501, body: "Created" }, SCOPE);
      let writes = 0;
      const engine = createSyncEngine({ comments: {
        addComment: async () => { writes++; throw new Error(`HTTP ${code}`); },
        getCurrentUserId: async () => 7,
        getIssueDetail: async () => ({ ...detail(), comments: [{ id: 701, ticketId: 501, body: "Created", authorId: 7, authorName: "Author", editableByCurrentUser: true }] }),
      } });
      assert.strictEqual((await engine.syncOne(key, context)).kind, "commit_unknown");
      assert.ok(engine.getRecoveryItems(key, context).every((item) => !item.allowedActions.includes("retry_remote_write")));
      await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
      await engine.syncOne(key, context);
      assert.strictEqual(writes, 1);
      assert.strictEqual((await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "reconcile_remote" } })).kind, "completed");
      assert.strictEqual(writes, 1);
    });
  }

  test("旧コメント保存経路でも競合確認GET失敗とコメント消失を拒否する", async () => {
    for (const unavailable of [true, false]) {
      let writes = 0;
      const result = await applyQueuedCommentUpdate({
        update: { ticketId: 501, commentId: 701, body: "New", baseBody: "Old", lastKnownRemoteUpdatedAt: "old" },
        deps: {
          updateComment: async () => { writes++; },
          getIssueDetail: async () => { if (unavailable) { throw new Error("GET failed"); } return detail(); },
        },
      });
      assert.strictEqual(writes, 0);
      assert.strictEqual(result.status, unavailable ? "failed" : "not_found");
    }
  });

  test("旧版でfailedとして保存された503コメントを再送しない", async () => {
    const key = { kind: "comment" as const, ticketId: 501 };
    await addOfflineCommentUpdateAsync({ ticketId: 501, body: "Comment" }, SCOPE);
    let writes = 0;
    const engine = createSyncEngine({ comments: { addComment: async () => { writes++; throw new Error("HTTP 500"); } } });
    await engine.syncOne(key, context);
    const repository = engine.getRepository();
    const op = repository.getOperation(key, SCOPE);
    assert.ok(op);
    const primary = getPrimaryEffectForRevision(op);
    assert.ok(primary?.failure);
    primary.failure.detail = "Redmine request failed (503): Service Unavailable";
    await repository.saveOperation(op, SCOPE);
    initializeOfflineSyncStore(memento, SCOPE);
    assert.ok(engine.getRecoveryItems(key, context).every((item) => !item.allowedActions.includes("retry_remote_write")));
    await engine.resolveCommentCommitUnknown({ key, context, resolution: { kind: "retry_remote_write" } });
    assert.strictEqual(writes, 1);
  });

});
