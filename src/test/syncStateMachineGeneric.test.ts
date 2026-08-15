import * as assert from "assert";
import {
  applyGenericTransition,
  isTransitionAllowed,
  normalizeOperationOnRestart,
} from "../app/ticketSync/syncStateMachine";
import type {
  GenericLifecycleAction,
  GenericSyncPhase,
  UnifiedSyncOperation,
} from "../app/ticketSync/syncOperationTypes";

const makeOp = (phase: GenericSyncPhase, overrides: Partial<UnifiedSyncOperation> = {}): UnifiedSyncOperation => ({
  operationId: "op-1",
  kind: "ticket_update",
  connectionScope: "https://test.example",
  phase,
  revision: 1,
  persistenceVersion: 1,
  ticketId: 100,
  intent: {
    ticketId: 100,
    baseSubject: "",
    baseDescription: "",
    baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
    subject: "Test",
    description: "",
    metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
  },
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  ...overrides,
});

suite("Generic SyncStateMachine", () => {
  test("queued -> preparing -> remote_write_started -> remote_committed -> completed の正常パス", () => {
    let op = makeOp("queued");

    // begin_preparation
    op = applyGenericTransition(op, { kind: "begin_preparation" })!;
    assert.strictEqual(op.phase, "preparing");
    assert.strictEqual(op.persistenceVersion, 2);

    // start_normal_remote_write
    op = applyGenericTransition(op, { kind: "start_normal_remote_write" })!;
    assert.strictEqual(op.phase, "remote_write_started");
    assert.strictEqual(op.persistenceVersion, 3);

    // record_remote_commit
    op = applyGenericTransition(op, { kind: "record_remote_commit", remoteUpdatedAt: "2026-08-14T10:00:00Z" })!;
    assert.strictEqual(op.phase, "remote_committed");
    assert.strictEqual(op.remoteUpdatedAt, "2026-08-14T10:00:00Z");

    // mark_local_finalize_pending
    op = applyGenericTransition(op, { kind: "mark_local_finalize_pending" })!;
    assert.strictEqual(op.phase, "local_finalize_pending");

    // complete
    op = applyGenericTransition(op, { kind: "complete" })!;
    assert.strictEqual(op.phase, "completed");
  });

  test("remote_write_started でタイムアウトした場合は commit_unknown となり自動再送できない (INV-04)", () => {
    let op = makeOp("remote_write_started");

    // mark_commit_unknown
    op = applyGenericTransition(op, { kind: "mark_commit_unknown", message: "Timeout" })!;
    assert.strictEqual(op.phase, "commit_unknown");

    // 通常の begin_preparation や start_normal_remote_write は禁止
    assert.strictEqual(isTransitionAllowed(op.phase, "begin_preparation"), false);
    assert.strictEqual(isTransitionAllowed(op.phase, "start_normal_remote_write"), false);

    // 明示的な assume_remote_commit または record_reconciled_identity のみ許可 (INV-04)
    assert.strictEqual(isTransitionAllowed(op.phase, "assume_remote_commit"), true);
    assert.strictEqual(isTransitionAllowed(op.phase, "record_reconciled_identity"), true);
  });

  test("commit_unknown から assume_remote_commit または record_reconciled_identity への復旧", () => {
    let op = makeOp("commit_unknown", { kind: "ticket_create" });

    // assume_remote_commit
    const assumed = applyGenericTransition(op, { kind: "assume_remote_commit", remoteId: 999 })!;
    assert.strictEqual(assumed.phase, "remote_committed");
    assert.strictEqual(assumed.createdRemoteId, 999);

    // record_reconciled_identity
    const reconciled = applyGenericTransition(op, { kind: "record_reconciled_identity", remoteId: 888 })!;
    assert.strictEqual(reconciled.phase, "local_finalize_pending");
    assert.strictEqual(reconciled.createdRemoteId, 888);
  });

  test("不正な遷移は undefined を返す", () => {
    const queuedOp = makeOp("queued");
    assert.strictEqual(applyGenericTransition(queuedOp, { kind: "record_remote_commit" }), undefined);
    assert.strictEqual(applyGenericTransition(queuedOp, { kind: "complete" }), undefined);

    const completedOp = makeOp("completed");
    assert.strictEqual(applyGenericTransition(completedOp, { kind: "begin_preparation" }), undefined);
  });

  test("RT-05: remote_committed -> complete および reconciliation_pending -> complete の直接遷移は禁止される (INV-09, INV-10)", () => {
    // remote_committed -> complete は禁止 (local_finalize を必ず経由する)
    assert.strictEqual(
      isTransitionAllowed("remote_committed", "complete"),
      false,
      "remote_committed から complete への直接遷移は禁止",
    );
    const remoteCommittedOp = makeOp("remote_committed");
    assert.strictEqual(
      applyGenericTransition(remoteCommittedOp, { kind: "complete" }),
      undefined,
      "remote_committed から complete を適用すると undefined を返すこと",
    );

    // reconciliation_pending -> complete は禁止
    assert.strictEqual(
      isTransitionAllowed("reconciliation_pending", "complete"),
      false,
      "reconciliation_pending から complete への直接遷移は禁止",
    );
    const reconcilPendingOp = makeOp("reconciliation_pending");
    assert.strictEqual(
      applyGenericTransition(reconcilPendingOp, { kind: "complete" }),
      undefined,
      "reconciliation_pending から complete を適用すると undefined を返すこと",
    );
  });

  test("プロセス再起動時の正規化: remote_write_started -> commit_unknown", () => {
    const startedOp = makeOp("remote_write_started");
    const normalized = normalizeOperationOnRestart(startedOp);
    assert.strictEqual(normalized.phase, "commit_unknown");
  });

  test("プロセス再起動時の正規化: preparing -> queued (nextIntent 昇格)", () => {
    const preparingOp = makeOp("preparing", {
      nextIntent: {
        ticketId: 100,
        baseSubject: "Base",
        baseDescription: "Base",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", start_date: "", due_date: "", children: [] },
        subject: "New Subject",
        description: "New Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", start_date: "", due_date: "", children: [] },
      },
      revision: 1,
    });
    const normalized = normalizeOperationOnRestart(preparingOp);
    assert.strictEqual(normalized.phase, "queued");
    assert.strictEqual(normalized.nextIntent, undefined);
    assert.strictEqual(normalized.revision, 2);
  });
});
