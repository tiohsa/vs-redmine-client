import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdate,
  addOfflineCommentUpdate,
  getOfflineSyncQueue,
  replaceOfflineSyncQueueAsync,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { computeFileHashAndSizeAsync } from "../utils/fileHash";
import { runWithConnectionScope } from "../redmine/client";

const SCOPE = "https://redmine.example.org/n01-n09-suite/";

const metadataDeps = {
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "New" }, { id: 2, name: "In Progress" }, { id: 3, name: "Closed" }],
  listTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
  listIssuePriorities: async () => [{ id: 1, name: "Low" }, { id: 2, name: "Normal" }, { id: 3, name: "High" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "dummy-token", filename: "dummy.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
};

suite("N01 〜 N09: Revision, Recovery Boundary & Legacy Compatibility Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // N-01: nextIntent + Primary known failure
  test("N-01: Revision 1 Primary known failure 後に nextIntent で Revision 2 へ昇格した場合、Revision 1 Effect は Revision 2 の Normal Sync を block せず Remote mutation 可能", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    // Revision 1 の失敗 Effect を持ち、nextIntent が昇格して Revision 2 となった Operation
    queue.tickets.set(1001, {
      ticketId: 1001,
      operationId: `${SCOPE}:ticket:1001`,
      phase: "queued",
      revision: 2,
      intentRevision: 2,
      subject: "Updated Subject v2",
      description: "Updated Description v2",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1001 },
          failure: { disposition: "retryable", detail: "400 Bad Request" },
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let updateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async (input: any) => {
          updateCalls++;
          return { id: 1001, subject: input.subject };
        },
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: "Updated Subject v2",
            description: "Updated Description v2",
            updatedAt: "2026-08-19T00:00:00Z",
          },
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "ticket", ticketId: 1001 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(updateCalls, 1, "Revision 2 の Remote update が1回呼ばれる");
    assert.strictEqual(outcome.kind, "completed", "同期が成功して completed になる");
  });

  // N-02: Secondary failed + nextIntent promotion
  test("N-02: Revision 1 Secondary Effect failed 後に nextIntent で Revision 2 へ昇格した場合、Revision 1 の Effect は Revision 2 を block しない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1002, {
      ticketId: 1002,
      operationId: `${SCOPE}:ticket:1002`,
      phase: "queued",
      revision: 2,
      intentRevision: 2,
      subject: "Updated Subject v2",
      description: "Updated Description v2",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "attachment:0",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1002, filename: "file.png" },
          failure: { disposition: "retryable", detail: "500 Internal Error" },
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let updateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async (input: any) => {
          updateCalls++;
          return { id: 1002, subject: input.subject };
        },
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: "Updated Subject v2",
            description: "Updated Description v2",
            updatedAt: "2026-08-19T00:00:00Z",
          },
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "ticket", ticketId: 1002 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(updateCalls, 1, "Revision 2 の Remote update が呼ばれる");
    assert.strictEqual(outcome.kind, "completed", "同期が成功して completed になる");
  });

  // N-03: Primary commit checkpoint failure / no restart
  test("N-03: Primary remote write 成功後 commit checkpoint persistence が失敗した場合 (remote_write_started + started)、restart なしで Recovery 可能かつ normal sync は remote retry 0", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1003, {
      ticketId: 1003,
      operationId: `${SCOPE}:ticket:1003`,
      phase: "remote_write_started",
      revision: 1,
      intentRevision: 1,
      subject: "Updated Subject",
      description: "Updated Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "started",
          target: { ticketId: 1003 },
          requestSnapshot: {
            kind: "ticket_update",
            request: { issueId: 1003, subject: "Updated Subject" },
          },
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let remoteUpdateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async () => {
          remoteUpdateCalls++;
          return { id: 1003 };
        },
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: "Updated Subject",
            description: "Updated Description",
            updatedAt: "2026-08-19T00:00:00Z",
          },
        }),
      },
    });

    // 1. Normal sync: remote retry は 0、commit_unknown を返す
    const normalOutcome = await engine.syncOne(
      { kind: "ticket", ticketId: 1003 },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(remoteUpdateCalls, 0, "Normal sync は remote retry しない (retry = 0)");
    assert.strictEqual(normalOutcome.kind, "commit_unknown", "commit_unknown を返す");

    // 2. Explicit recovery (reconcile_remote): restart なしで Recovery 可能
    const recoveryOutcome = await engine.resolveTicketCommitUnknown({
      key: { kind: "ticket", ticketId: 1003 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_remote" },
    });
    assert.strictEqual(remoteUpdateCalls, 0, "Reconcile recovery は remote write しない");
    assert.strictEqual(recoveryOutcome.kind, "completed", "Recovery が成功して completed になる");
  });

  // N-04: Legacy Primary commit_unknown / no Snapshot
  test("N-04: Legacy commit_unknown で requestSnapshot が欠損している場合、explicit retry による Remote write は 0 で安全に拒絶される", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1004, {
      ticketId: 1004,
      operationId: `${SCOPE}:ticket:1004`,
      phase: "commit_unknown",
      revision: 1,
      intentRevision: 1,
      subject: "Updated Subject",
      description: "Updated Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "commit_unknown",
          target: { ticketId: 1004 },
          // requestSnapshot は未定義 (legacy)
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let remoteUpdateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async () => {
          remoteUpdateCalls++;
          return { id: 1004 };
        },
      },
    });

    const outcome = await engine.resolveTicketCommitUnknown({
      key: { kind: "ticket", ticketId: 1004 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.strictEqual(remoteUpdateCalls, 0, "requestSnapshot 欠損の commit_unknown に対する remote write は 0");
    assert.ok(outcome.kind === "failed_before_commit" || outcome.kind === "commit_unknown", "安全に失敗/commit_unknown を返す");
  });

  // N-05: Legacy failed / missing disposition
  test("N-05: Legacy failed で failure.disposition が欠損している場合、normal sync / explicit retry ともに Remote write は 0", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1005, {
      ticketId: 1005,
      operationId: `${SCOPE}:ticket:1005`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      subject: "Updated Subject",
      description: "Updated Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1005 },
          // failure.disposition は欠損
          failure: { detail: "Unknown error" } as any,
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let remoteUpdateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async () => {
          remoteUpdateCalls++;
          return { id: 1005 };
        },
      },
    });

    // 1. Normal sync
    const normalOutcome = await engine.syncOne(
      { kind: "ticket", ticketId: 1005 },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(remoteUpdateCalls, 0, "Normal sync による remote write は 0");
    assert.strictEqual(normalOutcome.kind, "failed_before_commit");

    // 2. Explicit retry
    const retryOutcome = await engine.resolveTicketCommitUnknown({
      key: { kind: "ticket", ticketId: 1005 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    assert.strictEqual(remoteUpdateCalls, 0, "Explicit retry による remote write は 0");
    assert.ok(retryOutcome.kind === "failed_before_commit" || retryOutcome.kind === "commit_unknown");
  });

  // N-06: Legacy upload uncertainty / no identity
  test("N-06: Legacy uncertain upload で contentHash / contentSize が欠損している場合、Remote upload は 0", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1006, {
      ticketId: 1006,
      operationId: `${SCOPE}:ticket:1006`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      subject: "Updated Subject",
      description: "Updated Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "attachment:0",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { ticketId: 1006, filename: "test.png" },
          requestSnapshot: {
            kind: "upload",
            filename: "test.png",
            contentType: "image/png",
            // contentHash, contentSize は欠損
          } as any,
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let uploadCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        uploadFile: async () => {
          uploadCalls++;
          return { token: "token123", filename: "test.png", contentType: "image/png" };
        },
      },
    });

    const outcome = await engine.resolveEffect({
      key: { kind: "ticket", ticketId: 1006 },
      operationId: `${SCOPE}:ticket:1006`,
      operationRevision: 1,
      effectId: "attachment:0",
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(uploadCalls, 0, "content identity 不足の upload に対する remote upload は 0");
    assert.strictEqual(outcome.kind, "failed_before_commit", "Recovery は拒絶される");
  });

  // N-07: Secondary Product Recovery successful outcome
  test("N-07: Secondary Effect Recovery が成功した場合、syncUnsyncedFile の最終結果も success となり元の failure を返さない", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "n07-test-"));
    const tmpFile = path.join(tmpDir, "image.png");
    fs.writeFileSync(tmpFile, "fake-image-bytes");
    const fileIdentity = await computeFileHashAndSizeAsync(tmpFile);

    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1007, {
      ticketId: 1007,
      operationId: `${SCOPE}:ticket:1007`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      subject: "Updated Subject",
      description: "Updated Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Original Subject",
      baseDescription: "Original Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        {
          effectId: "attachment:0",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1007, filePath: tmpFile, filename: "image.png" },
          requestSnapshot: {
            kind: "upload",
            filePath: tmpFile,
            filename: "image.png",
            contentType: "image/png",
            contentHash: fileIdentity?.contentHash ?? "fakehash",
            contentSize: fileIdentity?.contentSize ?? 16,
          },
          failure: { disposition: "retryable", detail: "Network error" },
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    // showWarningMessage のモック: Retry を選択
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async (_msg: string, _opts: any, ...items: string[]) => {
      const retryLabel = items.find((i) => i.includes("Retry") || i === "Retry");
      return retryLabel ?? items[0];
    };

    let updateCalls = 0;
    let uploadCalls = 0;

    try {
      const result = await runWithConnectionScope(SCOPE, () => syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 1007 } },
        {
          createSyncEngine: () => createSyncEngine({
            tickets: {
              ...metadataDeps,
              uploadFile: async () => {
                uploadCalls++;
                return { token: "token-abc", filename: "image.png", contentType: "image/png" };
              },
              updateIssue: async () => {
                updateCalls++;
                return { id: 1007 };
              },
              getIssueDetail: async (id: number) => ({
                ticket: {
                  id,
                  projectId: 1,
                  subject: "Updated Subject",
                  description: "Updated Description",
                  updatedAt: "2026-08-19T00:00:00Z",
                },
              }),
            },
          }),
        },
      ));

      assert.ok(result, "result が返る");
      assert.strictEqual(result.status, "success", "syncUnsyncedFile のステータスは success");
      assert.strictEqual(result.kind, "ticket");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // N-08: Recovery Action Policy
  test("N-08: SyncEngine の getRecoveryItems は Policy 通りの allowedActions を返す", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1008, {
      ticketId: 1008,
      operationId: `${SCOPE}:ticket:1008`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      subject: "Test Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Test Ticket",
      baseDescription: "Description",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      effects: [
        // 1. failed (retryable) -> retry あり
        {
          effectId: "attachment:1",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1008, filename: "a.png" },
          requestSnapshot: { kind: "upload", filename: "a.png", contentType: "image/png", contentHash: "h1", contentSize: 10 },
          failure: { disposition: "retryable", detail: "Network timeout" },
        },
        // 2. failed (non_retriable) -> retry なし
        {
          effectId: "attachment:2",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "failed",
          target: { ticketId: 1008, filename: "b.png" },
          requestSnapshot: { kind: "upload", filename: "b.png", contentType: "image/png", contentHash: "h2", contentSize: 10 },
          failure: { disposition: "non_retriable", detail: "File too large (413)" },
        },
        // 3. child commit_unknown -> link_remote_child あり、retry_effect なし
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "commit_unknown",
          target: { parentTicketId: 1008 },
          requestSnapshot: { kind: "child_create", parentTicketId: 1008, request: { subject: "Child" } },
        },
        // 4. legacy uncertain missing identity -> remote mutation action なし
        {
          effectId: "attachment:3",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { ticketId: 1008, filename: "c.png" },
          requestSnapshot: { kind: "upload", filename: "c.png", contentType: "image/png" } as any, // missing contentHash & contentSize
        },
      ],
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const engine = createSyncEngine();
    const items = engine.getRecoveryItems(
      { kind: "ticket", ticketId: 1008 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(items.length, 4, "4つの RecoveryItem が返る");

    const item1 = items.find((i) => i.effectId === "attachment:1")!;
    assert.ok(item1.allowedActions.includes("retry_effect"), "retryable failed は retry_effect を含む");

    const item2 = items.find((i) => i.effectId === "attachment:2")!;
    assert.strictEqual(item2.allowedActions.includes("retry_effect"), false, "non_retriable failed は retry_effect を含まない");

    const item3 = items.find((i) => i.effectId === "child-create:0")!;
    assert.ok(item3.allowedActions.includes("link_remote_child"), "child commit_unknown は link_remote_child を含む");
    assert.strictEqual(item3.allowedActions.includes("retry_effect"), false, "child commit_unknown は retry_effect を含まない");

    const item4 = items.find((i) => i.effectId === "attachment:3")!;
    assert.strictEqual(item4.allowedActions.includes("retry_effect"), false, "identity 欠損 upload は retry_effect を含まない");
  });

  // N-09: Production async hash
  test("N-09: Production upload identity path で computeFileHashAndSizeAsync が正常に動作する", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "n09-test-"));
    const tmpFile = path.join(tmpDir, "async-test.png");
    fs.writeFileSync(tmpFile, "test-stream-content-for-async-hash");

    try {
      const identity = await computeFileHashAndSizeAsync(tmpFile);
      assert.ok(identity, "identity が計算できる");
      assert.strictEqual(typeof identity.contentHash, "string");
      assert.strictEqual(identity.contentSize, 34);
      assert.ok(identity.contentHash.length > 0);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
