import * as assert from "assert";
import {
  hasUncertainDurableSyncEffect,
  restoreDurableSyncEffect,
  transitionDurableSyncEffect,
  type DurableSyncEffect,
  type DurableSyncEffectAction,
  type DurableSyncEffectState,
} from "../app/syncEffects";

const plannedEffect = (): DurableSyncEffect => ({
  effectId: "child:0",
  kind: "child_create",
  operationRevision: 3,
  state: "planned",
  target: { parentTicketId: 42, ordinal: 0 },
});

suite("DurableSyncEffect state machine", () => {
  test("restart は started checkpoint を defensive copy した commit_unknown にする", () => {
    const started = { ...plannedEffect(), state: "started" as const };

    const restored = restoreDurableSyncEffect(started);

    assert.strictEqual(restored.state, "commit_unknown");
    assert.notStrictEqual(restored, started);
    assert.notStrictEqual(restored.target, started.target);
    assert.deepStrictEqual(restored.target, started.target);
  });

  test("restart は started を commit_unknown に、compensation_started を compensation_unknown に正規化し、それ以外の durable state を保持する", () => {
    assert.strictEqual(restoreDurableSyncEffect({ ...plannedEffect(), state: "started" }).state, "commit_unknown");
    assert.strictEqual(restoreDurableSyncEffect({ ...plannedEffect(), state: "compensation_started" }).state, "compensation_unknown");

    const states: DurableSyncEffectState[] = [
      "planned",
      "failed",
      "committed",
      "commit_unknown",
      "compensated",
      "compensation_unknown",
    ];

    for (const state of states) {
      assert.strictEqual(restoreDurableSyncEffect({ ...plannedEffect(), state }).state, state);
    }
  });

  test("remote result または compensation が不確定な effect を分類する", () => {
    const uncertainStates: DurableSyncEffectState[] = [
      "started",
      "commit_unknown",
      "compensation_started",
      "compensation_unknown",
    ];
    const settledStates: DurableSyncEffectState[] = [
      "planned",
      "failed",
      "committed",
      "compensated",
    ];

    for (const state of uncertainStates) {
      assert.strictEqual(
        hasUncertainDurableSyncEffect([{ ...plannedEffect(), state }]),
        true,
        state,
      );
    }
    for (const state of settledStates) {
      assert.strictEqual(
        hasUncertainDurableSyncEffect([{ ...plannedEffect(), state }]),
        false,
        state,
      );
    }
    assert.strictEqual(hasUncertainDurableSyncEffect(undefined), false);
    assert.strictEqual(hasUncertainDurableSyncEffect([]), false);
  });

  test("planned → started → committed を revision/state CAS で遷移する", () => {
    const started = transitionDurableSyncEffect(
      plannedEffect(),
      { kind: "start" },
      { operationRevision: 3, sourceState: "planned" },
    );
    assert.strictEqual(started?.state, "started");

    const committed = transitionDurableSyncEffect(
      started!,
      { kind: "commit", remoteId: 9001 },
      { operationRevision: 3, sourceState: "started" },
    );
    assert.strictEqual(committed?.state, "committed");
    assert.strictEqual(committed?.remoteId, 9001);
  });

  test("started の結果不明は commit_unknown となり通常 start へ戻せない", () => {
    const started = { ...plannedEffect(), state: "started" as const };
    const unknown = transitionDurableSyncEffect(
      started,
      { kind: "mark_commit_unknown", detail: "timeout" },
      { operationRevision: 3, sourceState: "started" },
    );

    assert.strictEqual(unknown?.state, "commit_unknown");
    assert.strictEqual(unknown?.detail, "timeout");
    assert.strictEqual(transitionDurableSyncEffect(
      unknown!,
      { kind: "start" },
      { operationRevision: 3, sourceState: "commit_unknown" },
    ), undefined);
  });

  test("committed effect の compensation 結果を同じ bounded record に保持する", () => {
    const committed: DurableSyncEffect = {
      ...plannedEffect(),
      state: "committed",
      remoteId: 9001,
    };
    const compensating = transitionDurableSyncEffect(
      committed,
      { kind: "start_compensation" },
      { operationRevision: 3, sourceState: "committed" },
    );
    const compensated = transitionDurableSyncEffect(
      compensating!,
      { kind: "complete_compensation" },
      { operationRevision: 3, sourceState: "compensation_started" },
    );

    assert.strictEqual(compensated?.state, "compensated");
    assert.strictEqual(compensated?.remoteId, 9001);
  });

  test("revision または source state が異なる遷移を拒否する", () => {
    assert.strictEqual(transitionDurableSyncEffect(
      plannedEffect(),
      { kind: "start" },
      { operationRevision: 4, sourceState: "planned" },
    ), undefined);
    assert.strictEqual(transitionDurableSyncEffect(
      plannedEffect(),
      { kind: "commit", remoteId: 1 },
      { operationRevision: 3, sourceState: "planned" },
    ), undefined);
  });

  test("known remote failure は commit_unknown と区別して failed にし、disposition を保持する", () => {
    const failed = transitionDurableSyncEffect(
      { ...plannedEffect(), state: "started" },
      { kind: "mark_failed", detail: "HTTP 400", disposition: "non_retriable" },
      { operationRevision: 3, sourceState: "started" },
    );

    assert.strictEqual(failed?.state, "failed");
    assert.strictEqual(failed?.detail, "HTTP 400");
    assert.strictEqual(failed?.failure?.disposition, "non_retriable");

    // non_retriable failed は start_explicit_retry できない
    const retryNonRetriable = transitionDurableSyncEffect(
      failed!,
      { kind: "start_explicit_retry" },
      { operationRevision: 3, sourceState: "failed" },
    );
    assert.strictEqual(retryNonRetriable, undefined, "non_retriable は retry 不可");

    // retryable failed は start_explicit_retry 可能
    const retryableFailed = transitionDurableSyncEffect(
      { ...plannedEffect(), state: "started" },
      { kind: "mark_failed", detail: "503 Service Unavailable", disposition: "retryable" },
      { operationRevision: 3, sourceState: "started" },
    );
    assert.strictEqual(retryableFailed?.state, "failed");
    assert.strictEqual(retryableFailed?.failure?.disposition, "retryable");

    const retried = transitionDurableSyncEffect(
      retryableFailed!,
      { kind: "start_explicit_retry" },
      { operationRevision: 3, sourceState: "failed" },
    );
    assert.strictEqual(retried?.state, "started", "retryable は started へ遷移可能");
    assert.strictEqual(retried?.failure, undefined, "retry 後は failure がクリアされる");
  });

  test("全state/action組合せがreference transition matrixと一致する", () => {
    const states: DurableSyncEffectState[] = [
      "planned",
      "started",
      "failed",
      "committed",
      "commit_unknown",
      "compensation_started",
      "compensated",
      "compensation_unknown",
    ];
    const actions: DurableSyncEffectAction[] = [
      { kind: "start" },
      { kind: "start_explicit_retry" },
      { kind: "commit", remoteId: 1 },
      { kind: "assume_committed", remoteId: 1 },
      { kind: "mark_commit_unknown" },
      { kind: "mark_failed" },
      { kind: "start_compensation" },
      { kind: "complete_compensation" },
      { kind: "mark_compensation_unknown" },
    ];
    const allowed = new Set([
      "planned:start",
      "planned:mark_failed",
      "started:commit",
      "started:mark_commit_unknown",
      "started:mark_failed",
      "failed:start_explicit_retry",
      "commit_unknown:start_explicit_retry",
      "commit_unknown:assume_committed",
      "committed:start_compensation",
      "compensation_started:complete_compensation",
      "compensation_started:mark_compensation_unknown",
      "compensation_unknown:start_compensation",
      "compensation_unknown:complete_compensation",
      "compensation_unknown:mark_compensation_unknown",
    ]);

    for (const state of states) {
      for (const action of actions) {
        const baseEffect = {
          ...plannedEffect(),
          state,
          failure: state === "failed" ? { disposition: "retryable" as const } : undefined,
        };
        const result = transitionDurableSyncEffect(
          baseEffect,
          action,
          { operationRevision: 3, sourceState: state },
        );
        assert.strictEqual(
          result !== undefined,
          allowed.has(`${state}:${action.kind}`),
          `${state}:${action.kind}`,
        );
      }
    }
  });
});
