import * as assert from "assert";
import {
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  transitionOfflineNewTicketLifecycleAsync,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import {
  createSyncOperationRepository,
  withAttemptGenerationFence,
} from "../app/ticketSync/syncRepository";
import { createSyncEngine } from "../app/syncEngine";
import {
  evaluateAttemptClosure,
  getRecoveryItemsForOperation,
  isAttemptClosureSafe,
  type DurableSyncEffect,
} from "../app/syncEffects";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import type { TicketUpdateIntent, SyncOperationKey } from "../app/ticketSync/syncOperationTypes";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/attempt-closure-p1-suite/";

const parentContent = buildTicketEditorContent({
  subject: "Parent",
  description: "Description",
  metadata: {
    tracker: "Bug",
    priority: "Normal",
    status: "New",
    due_date: "",
    children: [],
  },
});

const makeOperation = (): OfflineNewTicket => ({
  queueId: "p1-reproduction",
  operationId: `${SCOPE}:newTicket:p1-reproduction`,
  content: parentContent,
  projectId: 1,
  phase: "remote_created" as any,
  createdIssueId: 500,
  revision: 1,
  attemptGeneration: 1,
  effects: [
    {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      remoteId: 500,
      target: {},
    },
    {
      effectId: "child-create:0",
      kind: "child_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      remoteId: 501,
      target: { parentTicketId: 500, ordinal: 0 },
    },
    {
      effectId: "child-create:1",
      kind: "child_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "failed",
      failure: { disposition: "non_retriable", detail: "known child failure" },
      target: { parentTicketId: 500, ordinal: 1 },
    },
  ],
});

suite("Attempt Closure P1 reproduction", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
  });

  test("Child compensation_unknown が残る間は Parent compensated でも Attempt を閉じない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeOperation());
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "p1-reproduction" };

    const childCompensationStarted = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(childCompensationStarted);

    const childCompensationUnknown = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "mark_compensation_unknown", detail: "DELETE timeout" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(childCompensationUnknown);

    const parentCompensationStarted = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(parentCompensationStarted);

    const afterParentCompensation = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(afterParentCompensation);

    assert.strictEqual(afterParentCompensation?.attemptGeneration, 1);
    assert.strictEqual(afterParentCompensation?.createdRemoteId, 500);
    assert.strictEqual(
      afterParentCompensation?.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
      "compensation_unknown",
    );
    assert.strictEqual(afterParentCompensation?.effects?.find((effect) => effect.effectId === "ticket-create")?.state, "compensated");
  });

  test("Current Generation の terminal-safe state matrix を境界値で固定する", () => {
    const cases: Array<[DurableSyncEffect["state"], boolean]> = [
      ["planned", true],
      ["failed", true],
      ["compensated", true],
      ["started", false],
      ["commit_unknown", false],
      ["compensation_started", false],
      ["compensation_unknown", false],
      ["committed", false],
    ];

    for (const [state, expected] of cases) {
      const effect: DurableSyncEffect = {
        effectId: `child-${state}`,
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state,
        target: {},
      };
      const decision = evaluateAttemptClosure([effect]);
      assert.strictEqual(decision.closable, expected, `${state} の closure 判定`);
      const classification = decision.classifications[0]?.classification;
      const expectedClassification = state === "planned"
        ? "NO_REMOTE_OBLIGATION"
        : state === "failed"
          ? "NO_REMOTE_OBLIGATION"
          : state === "compensated"
            ? "COMPENSATED"
            : state === "committed"
              ? "EXPLICIT_COMPENSATION_REQUIRED"
              : "RECOVERY_REQUIRED";
      assert.strictEqual(classification, expectedClassification, `${state} の semantic classification`);
      assert.strictEqual(isAttemptClosureSafe([effect]), expected, `${state} の compatibility closure 判定`);
    }
  });

  test("T02: revision と attachment token/snapshot の不一致は blocker と evidence を保持する", () => {
    const coveredToken = {
      token: "snapshot-token",
      filename: "diagram.png",
      content_type: "image/png",
    };
    const decision = evaluateAttemptClosure({
      revision: 1,
      intentRevision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent",
              description: "Description",
              uploads: [coveredToken],
            },
          },
        },
        {
          effectId: "attachment:file:mismatch",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: "remote-token-not-in-snapshot",
          target: { token: "remote-token-not-in-snapshot", filename: "diagram.png" },
        },
        {
          effectId: "child-create:revision-mismatch",
          kind: "child_create",
          operationRevision: 2,
          attemptGeneration: 1,
          state: "failed",
          failure: { disposition: "non_retriable", detail: "revision mismatch" },
          target: {},
        },
      ],
    });

    assert.strictEqual(decision.closable, false);
    assert.deepStrictEqual(decision.coveredEffects, []);
    const attachment = decision.classifications.find(
      (classification) => classification.effectId === "attachment:file:mismatch",
    );
    assert.strictEqual(attachment?.classification, "RECOVERY_REQUIRED");
    const attachmentBlocker = decision.blockers.find(
      (blocker) => blocker.effectId === "attachment:file:mismatch",
    );
    assert.strictEqual(attachmentBlocker?.reason, "COVERAGE_MISSING");
    assert.strictEqual(attachmentBlocker?.operationRevision, 1);
    assert.strictEqual(attachmentBlocker?.attemptGeneration, 1);

    const revisionMismatch = decision.blockers.find(
      (blocker) => blocker.effectId === "child-create:revision-mismatch",
    );
    assert.strictEqual(revisionMismatch?.classification, "INVARIANT_VIOLATION");
    assert.strictEqual(revisionMismatch?.reason, "INVARIANT_VIOLATION");
    assert.strictEqual(revisionMismatch?.operationRevision, 2);
    assert.strictEqual(revisionMismatch?.attemptGeneration, 1);
  });

  test("T03: image_upload committed は Parent compensation で covered 扱いにしない", () => {
    const decision = evaluateAttemptClosure({
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent",
              description: "Description",
              uploads: [],
            },
          },
        },
        {
          effectId: "image-upload:0",
          kind: "image_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: "image-token",
          target: { imageUri: "file:///diagram.png", token: "image-token" },
        },
      ],
    });

    assert.strictEqual(decision.closable, false);
    assert.deepStrictEqual(decision.coveredEffects, []);
    const blocker = decision.blockers.find((item) => item.effectId === "image-upload:0");
    assert.strictEqual(blocker?.classification, "RECOVERY_REQUIRED");
    assert.strictEqual(blocker?.reason, "RECOVERY_REQUIRED");
  });

  test("R01/R04: coverage missing は理由付き manual_repair_required として公開する", () => {
    const items = getRecoveryItemsForOperation({
      operationId: `${SCOPE}:newTicket:manual-repair-attachment`,
      kind: "ticket_create",
      phase: "remote_created",
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent",
              description: "Description",
              uploads: [],
            },
          },
        },
        {
          effectId: "attachment:file:missing-coverage",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: "uncovered-token",
          target: { filename: "diagram.png", token: "uncovered-token" },
        },
      ],
    });

    const item = items.find((candidate) =>
      candidate.effectId === "attachment:file:missing-coverage");
    assert.ok(item);
    assert.deepStrictEqual(item?.allowedActions, []);
    assert.strictEqual(item?.disposition, "manual_repair_required");
    assert.strictEqual(item?.manualRepairReason, "COVERAGE_MISSING");
    assert.match(item?.message ?? "", /Manual repair required/);
  });

  test("R02: coverage missing の通常 sync は forward mutation を実行しない", async () => {
    const queueId = "manual-repair-forward-blocked";
    const operationId = `${SCOPE}:newTicket:${queueId}`;
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId,
      phase: "remote_created",
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent",
              description: "Description",
              uploads: [],
            },
          },
        },
        {
          effectId: "attachment:file:missing-coverage",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: "uncovered-token",
          target: { filename: "diagram.png", token: "uncovered-token" },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let handlerCalls = 0;
    const coordinator = new SyncCoordinator({
      repository: createSyncOperationRepository(),
      handlers: {
        ticketCreate: {
          prepare: async () => {
            handlerCalls++;
            throw new Error("manual repair 中は forward handler を実行しないこと");
          },
        } as any,
      },
    });

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(handlerCalls, 0);
    const retained = createSyncOperationRepository().getOperation(
      { kind: "newTicket", queueId },
      SCOPE,
    );
    assert.strictEqual(retained?.attemptGeneration, 1);
    assert.strictEqual(
      retained?.effects?.find((effect) => effect.effectId === "attachment:file:missing-coverage")?.state,
      "committed",
    );
  });

  test("R04: synthetic invariant blocker も空 action だけでなく理由を公開する", () => {
    const items = getRecoveryItemsForOperation({
      operationId: `${SCOPE}:newTicket:manual-repair-invariant`,
      kind: "ticket_create",
      phase: "remote_created",
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create-a",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
        },
        {
          effectId: "ticket-create-b",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 501,
          target: {},
        },
      ],
    });

    const invariant = items.find((candidate) => candidate.effectId === "__primary__");
    assert.strictEqual(invariant?.disposition, "manual_repair_required");
    assert.strictEqual(invariant?.manualRepairReason, "INVARIANT_VIOLATION");
    assert.deepStrictEqual(invariant?.allowedActions, []);
    assert.match(invariant?.message ?? "", /Multiple Primary effects/);
  });

  test("R03/T04: Primary compensated + Child committed は blocker かつ reconcile_compensation のみ", () => {
    const operation = {
      operationId: `${SCOPE}:newTicket:committed-child-recovery`,
      kind: "ticket_create",
      phase: "remote_created",
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create" as const,
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated" as const,
          remoteId: 500,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create" as const,
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed" as const,
          remoteId: 501,
          target: { parentTicketId: 500, ordinal: 0 },
        },
      ],
    };
    const decision = evaluateAttemptClosure(operation);
    assert.strictEqual(decision.closable, false);
    const childBlocker = decision.blockers.find((item) => item.effectId === "child-create:0");
    assert.strictEqual(childBlocker?.classification, "EXPLICIT_COMPENSATION_REQUIRED");
    assert.strictEqual(childBlocker?.reason, "ROLLBACK_REQUIRED");

    const childRecovery = getRecoveryItemsForOperation(operation).find(
      (item) => item.effectId === "child-create:0",
    );
    assert.ok(childRecovery);
    assert.deepStrictEqual(childRecovery?.allowedActions, ["reconcile_compensation"]);
    assert.strictEqual(childRecovery?.disposition, "actionable");
  });

  test("T05: restart 後も coverage decision、blocker、generation が一致する", async () => {
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const coveredToken = {
      token: "restart-covered-token",
      filename: "diagram.png",
      content_type: "image/png",
    };
    const operation: OfflineNewTicket = {
      queueId: "restart-coverage",
      operationId: `${SCOPE}:newTicket:restart-coverage`,
      content: parentContent,
      projectId: 1,
      phase: "remote_created",
      createdIssueId: 500,
      revision: 1,
      attemptGeneration: 3,
      connectionScope: SCOPE,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 3,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Restart parent",
              description: "Description",
              uploads: [coveredToken],
            },
          },
        },
        {
          effectId: "attachment:file:restart",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 3,
          state: "committed",
          token: coveredToken.token,
          target: { token: coveredToken.token, filename: coveredToken.filename },
        },
        {
          effectId: "image-upload:restart",
          kind: "image_upload",
          operationRevision: 1,
          attemptGeneration: 3,
          state: "committed",
          token: "restart-image-token",
          target: { token: "restart-image-token", imageUri: "file:///restart.png" },
        },
      ],
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(operation);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const before = getOfflineSyncQueue(SCOPE).newTickets.find(
      (ticket) => ticket.queueId === operation.queueId,
    );
    assert.ok(before);
    const beforeDecision = evaluateAttemptClosure(before, 1, 3);

    // VS Code restart を表すため、同じ persisted Memento から store を再初期化する。
    initializeOfflineSyncStore(storage, SCOPE);
    const after = getOfflineSyncQueue(SCOPE).newTickets.find(
      (ticket) => ticket.queueId === operation.queueId,
    );
    assert.ok(after);
    const afterDecision = evaluateAttemptClosure(after, 1, 3);

    assert.strictEqual(after?.attemptGeneration, before?.attemptGeneration);
    assert.deepStrictEqual(afterDecision, beforeDecision);
    assert.strictEqual(
      afterDecision.coveredEffects.find((effect) => effect.effectId === "attachment:file:restart")?.classification,
      "COVERED_BY_PARENT_COMPENSATION",
    );
    assert.strictEqual(
      afterDecision.blockers.find((blocker) => blocker.effectId === "image-upload:restart")?.reason,
      "RECOVERY_REQUIRED",
    );
  });

  test("T06: SyncEngine.resolveEffect の generation 省略は Remote/Persistence/Memory を変更しない", async () => {
    const backing = createTestMemento();
    let persistenceWrites = 0;
    const storage: TestMemento = {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        persistenceWrites++;
        await backing.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const queue = getOfflineSyncQueue(SCOPE);
    const queueId = "missing-generation-engine";
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId: `${SCOPE}:newTicket:${queueId}`,
      connectionScope: SCOPE,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    persistenceWrites = 0;
    const before = JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets);
    let remoteDeleteCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        deleteIssue: async () => {
          remoteDeleteCalls++;
        },
      },
    });

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId },
      operationId: `${SCOPE}:newTicket:${queueId}`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "committed",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(remoteDeleteCalls, 0);
    assert.strictEqual(persistenceWrites, 0);
    assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets), before);
  });

  test("T07: legacy complete_compensation の Memento failure は memory/evidence/generation を保持する", async () => {
    const backing = createTestMemento();
    let failWrites = false;
    const storage: TestMemento = {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        if (failWrites) {
          throw new Error("legacy Memento write failed");
        }
        await backing.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const queueId = "legacy-compensation-failure";
    const token = {
      token: "legacy-covered-token",
      filename: "legacy.png",
      content_type: "image/png",
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId: `${SCOPE}:newTicket:${queueId}`,
      phase: "remote_created",
      createdIssueId: 500,
      connectionScope: SCOPE,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Legacy parent",
              description: "Description",
              uploads: [token],
            },
          },
        },
        {
          effectId: "attachment:file:legacy",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: token.token,
          target: { token: token.token, filename: token.filename },
        },
        {
          effectId: "child-create:failed",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "failed",
          failure: { disposition: "non_retriable", detail: "known failure" },
          target: {},
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const before = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === queueId);
    assert.ok(before);
    const beforeJson = JSON.stringify(before);
    failWrites = true;

    const result = await transitionOfflineNewTicketLifecycleAsync(
      { queueId },
      { kind: "complete_compensation" },
      SCOPE,
      {
        operationId: `${SCOPE}:newTicket:${queueId}`,
        revision: 1,
        attemptGeneration: 1,
        sourcePhase: "remote_created",
      },
    );

    assert.strictEqual(result, undefined);
    const after = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === queueId);
    assert.ok(after);
    assert.strictEqual(after?.attemptGeneration, 1);
    assert.strictEqual(after?.createdIssueId, 500);
    assert.strictEqual(after?.effects?.find((effect) => effect.effectId === "attachment:file:legacy")?.token, token.token);
    assert.strictEqual(after?.effects?.find((effect) => effect.effectId === "attachment:file:legacy")?.state, "committed");
    assert.strictEqual(JSON.stringify(after), beforeJson);
  });

  test("T08: closure boundary は 0/1/multiple attachment・Child を分類する", () => {
    const empty = evaluateAttemptClosure([]);
    assert.strictEqual(empty.closable, true);
    assert.strictEqual(empty.classifications.length, 0);
    assert.strictEqual(empty.blockers.length, 0);

    const one = evaluateAttemptClosure([{
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "compensated",
      target: {},
    }]);
    assert.strictEqual(one.closable, true);
    assert.strictEqual(one.classifications.length, 1);
    assert.strictEqual(one.classifications[0]?.classification, "COMPENSATED");

    const attachments = ["attachment-0", "attachment-1"];
    const multiple = evaluateAttemptClosure([
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "compensated",
        target: {},
        requestSnapshot: {
          kind: "ticket_create",
          request: {
            projectId: 1,
            subject: "Multiple",
            description: "Description",
            uploads: attachments.map((token) => ({ token, filename: `${token}.png`, content_type: "image/png" })),
          },
        },
      },
      ...attachments.map((token, index): DurableSyncEffect => ({
        effectId: `attachment:file:${index}`,
        kind: "attachment_upload",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "committed",
        token,
        target: { token, ordinal: index },
      })),
      {
        effectId: "child-create:0",
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "compensated",
        target: { ordinal: 0 },
      },
      {
        effectId: "child-create:1",
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "failed",
        failure: { disposition: "non_retriable" },
        target: { ordinal: 1 },
      },
    ]);
    assert.strictEqual(multiple.closable, true);
    assert.strictEqual(multiple.classifications.length, 5);
    assert.strictEqual(multiple.coveredEffects.length, 2);
    assert.strictEqual(multiple.blockers.length, 0);
  });

  test("T09: scope mismatch は legacy lifecycle を変更しない", async () => {
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const queueId = "legacy-scope-mismatch";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId: `${SCOPE}:newTicket:${queueId}`,
      phase: "remote_created",
      connectionScope: `${SCOPE}other`,
      effects: [{
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "compensated",
        target: {},
      }],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const before = JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets);
    const result = await transitionOfflineNewTicketLifecycleAsync(
      { queueId },
      { kind: "complete_compensation" },
      SCOPE,
      {
        operationId: `${SCOPE}:newTicket:${queueId}`,
        revision: 1,
        attemptGeneration: 1,
        sourcePhase: "remote_created",
      },
    );
    assert.strictEqual(result, undefined);
    assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets), before);
  });

  test("T10: synthetic 1000 Effects は classification count と closure persistence を線形 gate する", async () => {
    const storageBacking = createTestMemento();
    let persistenceWrites = 0;
    const storage: TestMemento = {
      get: storageBacking.get,
      keys: storageBacking.keys,
      update: async (key, value) => {
        persistenceWrites++;
        await storageBacking.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const effects: DurableSyncEffect[] = [
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "compensation_started",
        remoteId: 900,
        target: {},
      },
      ...Array.from({ length: 999 }, (_, index): DurableSyncEffect => ({
        effectId: `child-create:${index}`,
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "failed",
        failure: { disposition: "non_retriable" },
        target: { ordinal: index },
      })),
    ];
    const decisionBefore = evaluateAttemptClosure({
      revision: 1,
      attemptGeneration: 1,
      effects,
    });
    assert.strictEqual(decisionBefore.classifications.length, 1000);
    assert.strictEqual(decisionBefore.blockers.length, 1);
    assert.strictEqual(decisionBefore.blockers[0]?.effectId, "ticket-create");

    const queueId = "synthetic-1000-effects";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId: `${SCOPE}:newTicket:${queueId}`,
      phase: "remote_created",
      createdIssueId: 900,
      effects,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    persistenceWrites = 0;
    const repository = createSyncOperationRepository();
    const closed = await repository.transitionEffect(
      { kind: "newTicket", queueId },
      "ticket-create",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.deepStrictEqual(closed?.effects, []);
    assert.ok(persistenceWrites <= 1, `closure persistence writes=${persistenceWrites}`);
  });

  test("Secondary compensation が完了するまで閉じず、最後の完了で一度だけ次世代へ進む", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "secondary-recovery",
      operationId: `${SCOPE}:newTicket:secondary-recovery`,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 501,
          target: { parentTicketId: 500, ordinal: 0 },
        },
        {
          effectId: "child-create:1",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 502,
          target: { parentTicketId: 500, ordinal: 1 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "secondary-recovery" };
    const first = await repository.transitionEffect(
      key,
      "child-create:1",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    assert.ok(first);
    assert.strictEqual(first?.attemptGeneration, 1);
    assert.strictEqual(first?.createdRemoteId, 500);
    assert.strictEqual(first?.effects?.length, 3);

    const closed = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.strictEqual(closed?.phase, "queued");
    assert.strictEqual(closed?.createdRemoteId, undefined);
    assert.deepStrictEqual(closed?.effects, []);
  });

  test("Closure時に nextIntent の revision と exact fields をそのまま昇格する", async () => {
    const metadata = {
      tracker: "Bug",
      priority: "High",
      status: "In Progress",
      due_date: "2026-12-31",
      children: ["Next child"],
    };
    const nextContent = "# Next exact content\n\nBody\n";
    const nextIntent: OfflineTicketUpdate["nextIntent"] = {
      revision: 7,
      subject: "Next subject",
      description: "Next description",
      content: nextContent,
      metadata,
      layout: "subject-first",
      metadataBlock: "present",
      controlFields: { mode: "ticket-update", issue_id: 42, project_id: 9 },
      baseDir: "/workspace/next",
      documentUri: "file:///workspace/next.md",
    };
    const current: OfflineTicketUpdate = {
      ticketId: 42,
      operationId: `${SCOPE}:ticket:42`,
      phase: "remote_committed",
      revision: 1,
      attemptGeneration: 1,
      baseSubject: "Old subject",
      baseDescription: "Old description",
      baseMetadata: metadata,
      subject: "Old subject",
      description: "Old description",
      content: "# Old exact content\n",
      metadata,
      layout: "metadata-first",
      metadataBlock: "present",
      controlFields: { mode: "ticket-update", issue_id: 42, project_id: 1 },
      baseDir: "/workspace/old",
      documentUri: "file:///workspace/old.md",
      nextIntent,
      effects: [{
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "committed",
        remoteId: 42,
        target: { ticketId: 42 },
      }],
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(42, current);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key: SyncOperationKey = { kind: "ticket", ticketId: 42 };
    const started = await repository.transitionEffect(
      key,
      "ticket-update",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(started);
    const closed = await repository.transitionEffect(
      key,
      "ticket-update",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(closed);

    const promoted = repository.getOperation<TicketUpdateIntent>(key, SCOPE);
    assert.ok(promoted);
    assert.strictEqual(promoted?.attemptGeneration, 2);
    assert.strictEqual(promoted?.revision, 7);
    assert.strictEqual(promoted?.intentRevision, 7);
    assert.strictEqual(promoted?.phase, "queued");
    assert.strictEqual(promoted?.nextIntent, undefined);
    assert.strictEqual(promoted?.documentUri, nextIntent.documentUri);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).subject, nextIntent.subject);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).description, nextIntent.description);
    assert.deepStrictEqual((promoted?.intent as TicketUpdateIntent).metadata, metadata);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).content, nextContent);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).layout, nextIntent.layout);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).metadataBlock, nextIntent.metadataBlock);
    assert.deepStrictEqual((promoted?.intent as TicketUpdateIntent).controlFields, nextIntent.controlFields);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseDir, nextIntent.baseDir);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).documentUri, nextIntent.documentUri);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseSubject, "Old subject");
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseDescription, "Old description");
  });

  test("Closure後の stale Secondary recovery は remote/persistence を発生させない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "stale-secondary",
      operationId: `${SCOPE}:newTicket:stale-secondary`,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 600,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 601,
          target: { parentTicketId: 600, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    await repository.transitionEffect(
      { kind: "newTicket", queueId: "stale-secondary" },
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    const before = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "stale-secondary");
    assert.strictEqual(before?.attemptGeneration, 2);
    const staleSnapshot = JSON.stringify(before);
    let deleteCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        deleteIssue: async () => {
          deleteCalls++;
        },
      },
    });
    const stale = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "stale-secondary" },
      operationId: `${SCOPE}:newTicket:stale-secondary`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(stale.kind, "failed_before_commit");
    assert.strictEqual(deleteCalls, 0);
    assert.strictEqual(
      JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "stale-secondary")),
      staleSnapshot,
    );
  });

  test("Core Recovery は operation identity と generation の省略を拒否する", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "core-identity",
      operationId: `${SCOPE}:newTicket:core-identity`,
      phase: "commit_unknown" as any,
      effects: [{
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "commit_unknown",
        target: {},
      }],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const before = JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets);
    const coordinator = new SyncCoordinator({ repository: createSyncOperationRepository() });
    const outcome = await (coordinator.resolveCommitUnknown as (input: Record<string, unknown>) => Promise<{ kind: string }>)({
      key: { kind: "newTicket", queueId: "core-identity" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets), before);
  });

  test("Old generation の fenced delete は Current Attempt を削除しない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "delete-fence",
      operationId: `${SCOPE}:newTicket:delete-fence`,
      attemptGeneration: 2,
      phase: "queued",
      effects: [],
      createdIssueId: undefined,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "delete-fence" };
    const staleDelete = await withAttemptGenerationFence(repository, 1).deleteOperation(key, SCOPE);
    assert.strictEqual(staleDelete, false);
    assert.ok(getOfflineSyncQueue(SCOPE).newTickets.some((ticket) => ticket.queueId === "delete-fence"));
  });

  test("Compensation persistence failure は remote evidence を消去せず同一世代に留める", async () => {
    const backing = createTestMemento();
    let failWrites = false;
    const storage: TestMemento = {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        if (failWrites) {
          throw new Error("Memento write failed");
        }
        await backing.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "persistence-failure",
      operationId: `${SCOPE}:newTicket:persistence-failure`,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "persistence-failure" };
    const started = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(started);
    failWrites = true;
    const completed = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.strictEqual(completed, undefined);
    const afterFailure = repository.getOperation(key, SCOPE);
    assert.strictEqual(afterFailure?.attemptGeneration, 1);
    assert.strictEqual(afterFailure?.createdRemoteId, 500);
    assert.strictEqual(
      afterFailure?.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
      "compensation_started",
    );
  });

  test("Primary compensated の closure persistence failure は次回 sync で Remote 0 のまま再試行できる", async () => {
    const backing = createTestMemento();
    let failWrites = false;
    const storage: TestMemento = {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        if (failWrites) {
          throw new Error("Memento write failed");
        }
        await backing.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const queueId = "closure-retry-after-persistence-failure";
    const operationId = `${SCOPE}:newTicket:${queueId}`;
    const uploadToken = {
      token: "covered-token-for-closure-retry",
      filename: "covered.png",
      content_type: "image/png",
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "attachment:file:0",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          token: uploadToken.token,
          target: { filename: uploadToken.filename },
        },
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent",
              description: "Description",
              uploads: [uploadToken],
            },
          },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "failed",
          failure: { disposition: "non_retriable", detail: "known failure" },
          target: { parentTicketId: 500, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    failWrites = true;
    const failedClosure = await transitionOfflineNewTicketLifecycleAsync(
      { queueId },
      { kind: "complete_compensation" },
      SCOPE,
      {
        operationId,
        revision: 1,
        attemptGeneration: 1,
        sourcePhase: "remote_created",
      },
    );
    assert.strictEqual(failedClosure, undefined);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0]?.attemptGeneration, 1);

    failWrites = false;
    let handlerCalls = 0;
    const unreachableHandler = {
      prepare: async () => {
        handlerCalls++;
        throw new Error("handler must not run during closure-only retry");
      },
      executeRemoteWrite: async () => {
        handlerCalls++;
        throw new Error("remote write must not run during closure-only retry");
      },
      reconcileRemote: async () => {
        handlerCalls++;
        throw new Error("reconcile must not run during closure-only retry");
      },
      finalizeLocal: async () => {
        handlerCalls++;
        throw new Error("finalize must not run during closure-only retry");
      },
    } as any;
    const repository = createSyncOperationRepository();
    const coordinator = new SyncCoordinator({
      repository,
      handlers: { ticketCreate: unreachableHandler },
    });
    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(handlerCalls, 0);
    const afterRetry = repository.getOperation({ kind: "newTicket", queueId }, SCOPE);
    assert.strictEqual(afterRetry?.attemptGeneration, 2);
    assert.strictEqual(afterRetry?.phase, "queued");
    assert.deepStrictEqual(afterRetry?.effects, []);
    assert.strictEqual(afterRetry?.createdRemoteId, undefined);
  });

  test("Primary compensated + Child committed の通常 sync は Remote 0 で rollback-only に留まる", async () => {
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const queueId = "committed-child-normal-sync-blocked";
    const operationId = `${SCOPE}:newTicket:${queueId}`;
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          remoteId: 501,
          target: { parentTicketId: 500, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let handlerCalls = 0;
    const unreachableHandler = {
      prepare: async () => {
        handlerCalls++;
        throw new Error("handler must not run while rollback is blocked");
      },
    } as any;
    const repository = createSyncOperationRepository();
    const coordinator = new SyncCoordinator({
      repository,
      handlers: { ticketCreate: unreachableHandler },
    });
    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(handlerCalls, 0);
    const retained = repository.getOperation({ kind: "newTicket", queueId }, SCOPE);
    assert.strictEqual(retained?.attemptGeneration, 1);
    assert.strictEqual(retained?.effects?.find((effect) => effect.effectId === "child-create:0")?.state, "committed");
  });

  test("Closure後の New Attempt は new Parent ID を Child CREATE に渡す", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent after rollback",
      description: "Description",
      metadata: {
        tracker: "Bug",
        priority: "Normal",
        status: "New",
        due_date: "",
        children: ["Child after rollback"],
      },
    });
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "new-attempt-e2e",
      operationId: `${SCOPE}:newTicket:new-attempt-e2e`,
      content,
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 800,
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 800,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 801,
          target: { parentTicketId: 800, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const createdInputs: Array<{ subject?: string; parentId?: number }> = [];
    let nextId = 900;
    const createEngine = () => createSyncEngine({
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async (input: { subject?: string; parentId?: number }) => {
          createdInputs.push(input);
          nextId++;
          return nextId;
        },
        getIssueDetail: async (id: number) => {
          if (id === 801) {
            const error = Object.assign(new Error("404 Not Found"), { status: 404 });
            throw error;
          }
          return {
            ticket: {
              id,
              projectId: 1,
              subject: createdInputs.find((input) => input.parentId === undefined)?.subject ?? "Parent after rollback",
            },
            comments: [],
          };
        },
      },
    });
    const firstEngine = createEngine();
    const recovered = await firstEngine.resolveEffect({
      key: { kind: "newTicket", queueId: "new-attempt-e2e" },
      operationId: `${SCOPE}:newTicket:new-attempt-e2e`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(recovered.kind, "queued");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0]?.attemptGeneration, 2);

    initializeOfflineSyncStore(storage, SCOPE);
    const outcome = await createEngine().syncOne(
      { kind: "newTicket", queueId: "new-attempt-e2e" },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createdInputs.length, 2);
    assert.strictEqual(createdInputs[0]?.parentId, undefined);
    assert.strictEqual(createdInputs[1]?.parentId, nextId - 1);
  });

  test("Covered attachment を含む必須 rollback sequence は Child failure 後に Attempt を閉じる", async () => {
    const uploadToken = {
      token: "upload-token-covered-by-parent",
      filename: "diagram.png",
      content_type: "image/png",
    };
    const queueId = "covered-attachment-rollback";
    const key = { kind: "newTicket" as const, queueId };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId: `${SCOPE}:newTicket:${queueId}`,
      phase: "remote_committed" as any,
      createdIssueId: 700,
      effects: [
        {
          effectId: "attachment:file:0",
          kind: "attachment_upload",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "planned",
          token: undefined,
          target: { filename: uploadToken.filename, token: uploadToken.token },
        },
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "planned",
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: {
              projectId: 1,
              subject: "Parent with attachment",
              description: "Description",
              uploads: [uploadToken],
            },
          },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "planned",
          remoteId: undefined,
          target: { parentTicketId: 700, ordinal: 0 },
        },
        {
          effectId: "child-create:1",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "planned",
          target: { parentTicketId: 700, ordinal: 1 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const transition = async (
      effectId: string,
      action: Parameters<typeof repository.transitionEffect>[2],
      sourceState: DurableSyncEffect["state"],
    ) => repository.transitionEffect(
      key,
      effectId,
      action,
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState },
    );

    // Attachment committed
    assert.ok(await transition("attachment:file:0", { kind: "start" }, "planned"));
    assert.ok(await transition(
      "attachment:file:0",
      { kind: "commit", token: uploadToken.token },
      "started",
    ));

    // Parent committed (its frozen RequestSnapshot owns the attachment token)
    assert.ok(await transition("ticket-create", { kind: "start" }, "planned"));
    const parentCommitted = await transition(
      "ticket-create",
      { kind: "commit", remoteId: 700 },
      "started",
    );
    assert.ok(parentCommitted);
    assert.deepStrictEqual(
      parentCommitted?.effects?.find((effect) => effect.effectId === "ticket-create")?.requestSnapshot,
      {
        kind: "ticket_create",
        request: {
          projectId: 1,
          subject: "Parent with attachment",
          description: "Description",
          uploads: [uploadToken],
        },
      },
      "Primary ticket_create snapshot に attachment token が固定されていること",
    );

    // Child A committed
    assert.ok(await transition("child-create:0", { kind: "start" }, "planned"));
    assert.ok(await transition("child-create:0", { kind: "commit", remoteId: 701 }, "started"));

    // Child B known failure
    assert.ok(await transition(
      "child-create:1",
      { kind: "mark_failed", detail: "known child failure", disposition: "non_retriable" },
      "planned",
    ));

    // Child A compensated
    assert.ok(await transition("child-create:0", { kind: "start_compensation" }, "committed"));
    assert.ok(await transition("child-create:0", { kind: "complete_compensation" }, "compensation_started"));

    // Parent compensated — covered attachment + known failure は closure blocker ではない
    assert.ok(await transition("ticket-create", { kind: "start_compensation" }, "committed"));
    const closed = await transition("ticket-create", { kind: "complete_compensation" }, "compensation_started");
    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.strictEqual(closed?.phase, "queued");
    assert.strictEqual(closed?.createdRemoteId, undefined);
    assert.deepStrictEqual(closed?.effects, []);
  });

  test("Primary compensated + retryable Child blocker では retry_effect を remote call なしで拒否する", async () => {
    const queueId = "compensated-primary-retry-blocker";
    const operationId = `${SCOPE}:newTicket:${queueId}`;
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId,
      operationId,
      phase: "remote_committed" as any,
      createdIssueId: 702,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 702,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "failed",
          failure: { disposition: "retryable", detail: "retryable child blocker" },
          target: { parentTicketId: 702, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 702,
            projectId: 1,
            subject: "Child retry must be blocked",
            description: "Child",
            request: {
              projectId: 1,
              parentId: 702,
              subject: "Child retry must be blocked",
              description: "Child",
            },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let createIssueCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        createIssue: async () => {
          createIssueCalls++;
          return 703;
        },
      },
    });
    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId },
      operationId,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "failed",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(createIssueCalls, 0);
  });
});
