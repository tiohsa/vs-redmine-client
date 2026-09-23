import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardMessageRouter } from "../dashboard/DashboardMessageRouter";
import {
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  prepareOfflineDiscard,
  commitOfflineDiscardAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
  transitionOfflineNewTicketLifecycleAsync,
  transitionOfflineCommentLifecycleAsync,
  addOfflineTicketUpdateAsync,
  discardOfflineCommentUpdateAsync,
  discardOfflineNewTicketAsync,
  discardOfflineTicketUpdateAsync,
  evaluateOfflineSyncPolicy,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineTicketUpdate,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineSyncQueue,
} from "../views/offlineSyncStore";
import type { DurableSyncEffect, DurableSyncEffectState } from "../app/syncEffects";
import type { DashboardUnsyncedKey } from "../dashboard/dashboardProtocol";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import { resolveTicketSyncState } from "../dashboard/viewModels/ticketDashboardViewModel";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { clearTicketDrafts, initializeDraftStore, initializeTicketDraft, markDraftStatus } from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { syncLifecycleCases } from "./helpers/syncLifecycleFixtures";

suite("Dashboard recovery policy — lifecycle matrix", () => {
  const ticketId = 8123;
  const documentUri = "file:///tmp/recovery-comment.md";
  const metadata = buildIssueMetadataFixture();
  const update: OfflineTicketUpdate = {
    ticketId, baseSubject: "Base", baseDescription: "Base body", baseMetadata: metadata,
    subject: "Edited", description: "Edited body", metadata,
  };
  let scope: string;
  let storage: ReturnType<typeof createTestMemento>;
  let writes: number;
  setup(() => {
    scope = getCurrentConnectionScope();
    storage = createTestMemento();
    const persist = storage.update;
    writes = 0;
    storage.update = (key, value) => { writes++; return persist(key, value); };
    initializeOfflineSyncStore(storage, scope);
    initializeDraftStore(createInMemoryDraftStorage(), scope);
  });
  teardown(() => {
    clearTicketDrafts(scope);
    initializeOfflineSyncStore(createTestMemento(), scope);
  });

  const effect = (overrides: Partial<DurableSyncEffect> = {}): DurableSyncEffect => ({
    effectId: "attachment", kind: "attachment_upload", operationRevision: 4,
    attemptGeneration: 2, state: "planned", target: {}, ...overrides,
  });
  const queuedOperations = (effects: DurableSyncEffect[] = [], hasNext = false): OfflineSyncQueue => ({
    abandonedTickets: [],
    ticketEditAuthorizations: [],
    tickets: new Map([[ticketId, {
      ...update, phase: "queued", revision: 4, intentRevision: 4, attemptGeneration: 2, effects,
      nextIntent: hasNext ? { ...update, revision: 5, subject: "Later" } : undefined,
    }]]),
    comments: [{
      ticketId, commentId: 10, documentUri, body: "Comment", phase: "queued",
      revision: 4, intentRevision: 4, attemptGeneration: 2, effects,
      nextIntent: hasNext ? { revision: 5, body: "Later comment" } : undefined,
    }],
    newTickets: [{
      queueId: "new-recovery", documentUri, content: "New", phase: "queued",
      revision: 4, attemptGeneration: 2, effects,
      nextIntent: hasNext ? { revision: 5, content: "Later new" } : undefined,
    }],
  });
  const keys: DashboardUnsyncedKey[] = [
    { kind: "ticket", ticketId },
    { kind: "comment", ticketId, commentId: 10, documentUri },
    { kind: "newTicket", queueId: "new-recovery", documentUri },
  ];
  const discardAllKinds = async (): Promise<string[]> => [
    await discardOfflineTicketUpdateAsync(ticketId, scope),
    await discardOfflineCommentUpdateAsync({ ticketId, commentId: 10, documentUri }, scope),
    await discardOfflineNewTicketAsync({ queueId: "new-recovery", documentUri }, scope),
  ];
  const withoutNextIntents = (queue: OfflineSyncQueue): OfflineSyncQueue => ({
    ...queue,
    tickets: new Map(Array.from(queue.tickets, ([id, item]) => [id, { ...item, nextIntent: undefined }])),
    comments: queue.comments.map((item) => ({ ...item, nextIntent: undefined })),
    newTickets: queue.newTickets.map((item) => ({ ...item, nextIntent: undefined })),
  });
  const unsafeStates: DurableSyncEffectState[] = [
    "started", "committed", "commit_unknown", "failed", "compensation_started", "compensation_unknown", "compensated",
  ];
  const effectCases = [
    { label: "none", effects: [], unsafe: false },
    { label: "planned", effects: [effect()], unsafe: false },
    ...unsafeStates.map((state) => ({ label: state, effects: [effect({ state })], unsafe: true })),
    { label: "token", effects: [effect({ token: "uploaded" })], unsafe: true },
    { label: "remoteId", effects: [effect({ remoteId: 42 })], unsafe: true },
    { label: "target.token", effects: [effect({ target: { token: "uploaded" } })], unsafe: true },
    { label: "previous revision", effects: [effect({ state: "committed", operationRevision: 3 })], unsafe: true },
    { label: "previous attempt", effects: [effect({ state: "committed", attemptGeneration: 1 })], unsafe: true },
  ];

  test("evaluateOfflineSyncPolicy は discardMode と canDiscard を一貫して返す", () => {
    const policyFor = (
      phase: OfflineTicketUpdate["phase"],
      effects: DurableSyncEffect[],
      hasNext: boolean,
    ) => {
      const operation = queuedOperations(effects, hasNext).tickets.get(ticketId)!;
      operation.phase = phase;
      return evaluateOfflineSyncPolicy(operation);
    };

    assert.deepStrictEqual(policyFor("queued", [], false), {
      lifecycle: "queued", canDiscard: true, discardMode: "active",
    });
    assert.deepStrictEqual(policyFor("queued", [effect()], false), {
      lifecycle: "queued", canDiscard: true, discardMode: "active",
    });
    assert.deepStrictEqual(policyFor("queued", [effect({ state: "committed" })], false), {
      lifecycle: "queued", canDiscard: false, discardMode: "none",
    });
    assert.deepStrictEqual(policyFor("queued", [effect({ state: "committed" })], true), {
      lifecycle: "queued", canDiscard: true, discardMode: "nextIntent",
    });
    assert.deepStrictEqual(policyFor("reconciliation_pending", [], true), {
      lifecycle: "recovery_pending", canDiscard: true, discardMode: "nextIntent",
    });
    assert.deepStrictEqual(policyFor("commit_unknown", [effect({ state: "commit_unknown" })], true), {
      lifecycle: "commit_unknown", canDiscard: true, discardMode: "nextIntent",
    });
  });

  test("ambiguous な新規コメント recovery は allowedActions に基づいて Review を表示する", async () => {
    const primaryEffect: DurableSyncEffect = {
      effectId: "comment-create",
      kind: "comment_create",
      operationRevision: 4,
      attemptGeneration: 2,
      state: "committed",
      target: {},
    };
    await replaceOfflineSyncQueueAsync({
      tickets: new Map(),
      comments: [{
        ticketId,
        body: "Same text",
        operationId: "ambiguous-comment",
        connectionScope: scope,
        phase: "reconciliation_pending",
        revision: 4,
        intentRevision: 4,
        attemptGeneration: 2,
        effects: [primaryEffect],
      }],
      newTickets: [],
    }, scope);

    const [item] = buildUnsyncedDashboardItems();
    assert.strictEqual(item.lifecycle, "recovery_pending");
    assert.strictEqual(item.requiresReview, true);
  });

  for (const entry of effectCases) {
    for (const hasNext of [false, true]) {
      test(`queued Effect=${entry.label}, nextIntent=${hasNext}: 全種別の破棄・scope分離・再起動`, async () => {
        await replaceOfflineSyncQueueAsync(queuedOperations(entry.effects, hasNext), scope);
        await replaceOfflineSyncQueueAsync(queuedOperations(entry.effects, hasNext), "other-scope");
        const before = getOfflineSyncQueue(scope);
        const otherScope = getOfflineSyncQueue("other-scope");
        const expectedMode = entry.unsafe ? hasNext ? "nextIntent" : "none" : "active";
        assert.deepStrictEqual(buildUnsyncedDashboardItems().map(({ canDiscard, discardMode }) => ({ canDiscard, discardMode })),
          Array(3).fill({ canDiscard: expectedMode !== "none", discardMode: expectedMode }));
        const writeCount = writes;
        const expected = !entry.unsafe ? "discarded" : hasNext ? "discarded_next" : "recovery_required";
        assert.deepStrictEqual(await discardAllKinds(), Array(3).fill(expected));
        if (entry.unsafe) {
          assert.deepStrictEqual(getOfflineSyncQueue(scope), hasNext ? withoutNextIntents(before) : before);
          assert.strictEqual(writes, writeCount + (hasNext ? 3 : 0));
          if (hasNext) {
            const after = getOfflineSyncQueue(scope);
            const pairs = [
              [before.tickets.get(ticketId)!, after.tickets.get(ticketId)!],
              [before.comments[0], after.comments[0]],
              [before.newTickets[0], after.newTickets[0]],
            ] as const;
            for (const [original, active] of pairs) {
              assert.strictEqual(active.revision, original.revision);
              assert.strictEqual(active.attemptGeneration, original.attemptGeneration);
              assert.deepStrictEqual(active.effects, original.effects);
              assert.strictEqual(active.nextIntent, undefined);
            }
          }
        } else {
          assert.deepStrictEqual(getOfflineSyncQueue(scope), {
            tickets: new Map(), comments: [], newTickets: [], abandonedTickets: [], ticketEditAuthorizations: [],
          });
        }
        assert.deepStrictEqual(getOfflineSyncQueue("other-scope"), otherScope);
        initializeOfflineSyncStore(storage, scope);
        const restored = buildUnsyncedDashboardItems();
        assert.strictEqual(restored.length, entry.unsafe ? 3 : 0);
        if (entry.unsafe) {
          assert.ok(restored.every((item) => !item.canDiscard));
          const checkpoint = getOfflineSyncQueue(scope);
          // 再起動時は既存仕様に従い、実行中だったEffectを結果不明として復元する。
          const restoredEffects = entry.effects.map((item) => ({
            ...item,
            state: item.state === "started" ? "commit_unknown"
              : item.state === "compensation_started" ? "compensation_unknown" : item.state,
          }));
          assert.deepStrictEqual(checkpoint.tickets.get(ticketId)?.effects, restoredEffects);
          assert.deepStrictEqual(checkpoint.comments[0].effects, restoredEffects);
          assert.deepStrictEqual(checkpoint.newTickets[0].effects, restoredEffects);
          assert.deepStrictEqual(await discardAllKinds(), Array(3).fill("recovery_required"));
          assert.deepStrictEqual(getOfflineSyncQueue(scope), checkpoint);
        }
      });
    }
  }

  const checkpointCases: Array<{
    label: string;
    ticket: Partial<OfflineTicketUpdate>;
    comment: Partial<OfflineCommentUpdate> & { createdRemoteId?: number };
    newTicket: Partial<OfflineNewTicket>;
  }> = [
    { label: "remote identity", ticket: { remoteUpdatedAt: "2026-09-22" }, comment: { remoteProjectId: 1 }, newTicket: { createdIssueId: 42 } },
    { label: "child / draft finalize", ticket: { createdChildIds: [42] }, comment: { finalizeDraft: true }, newTicket: { createdChildIds: [42] } },
    { label: "legacy checkpoint", ticket: { remoteUpdatedAt: "2026-09-22" }, comment: { createdRemoteId: 10 }, newTicket: { status: "created_rewrite_failed" } },
    { label: "new ticket updatedAt", ticket: { createdChildIds: [42] }, comment: { remoteProjectId: 1 }, newTicket: { remoteUpdatedAt: "2026-09-22" } },
  ];
  for (const entry of checkpointCases) {
    for (const hasNext of [false, true]) {
      test(`queued ${entry.label}, nextIntent=${hasNext}: remote checkpointを保持する`, async () => {
        const queue = queuedOperations([], hasNext);
        Object.assign(queue.tickets.get(ticketId)!, entry.ticket);
        Object.assign(queue.comments[0], entry.comment);
        Object.assign(queue.newTickets[0], entry.newTicket);
        await replaceOfflineSyncQueueAsync(queue, scope);
        const before = getOfflineSyncQueue(scope);
        assert.deepStrictEqual(buildUnsyncedDashboardItems().map(({ canDiscard, discardMode }) => ({ canDiscard, discardMode })),
          Array(3).fill({ canDiscard: hasNext, discardMode: hasNext ? "nextIntent" : "none" }));
        assert.deepStrictEqual(await discardAllKinds(), Array(3).fill(hasNext ? "discarded_next" : "recovery_required"));
        assert.deepStrictEqual(getOfflineSyncQueue(scope), hasNext ? withoutNextIntents(before) : before);
        initializeOfflineSyncStore(storage, scope);
        assert.ok(buildUnsyncedDashboardItems().every((item) => !item.canDiscard));
      });
    }
  }

  for (const hasNext of [false, true]) {
    test(`queued破棄の永続化失敗、nextIntent=${hasNext}: memory・永続化済みsnapshotを保持する`, async () => {
      await replaceOfflineSyncQueueAsync(queuedOperations(hasNext ? [effect({ state: "committed" })] : [], hasNext), scope);
      const before = getOfflineSyncQueue(scope);
      const persisted = storage.keys().map((key) => storage.get(key));
      storage.update = async () => { throw new Error("injected persistence failure"); };
      assert.deepStrictEqual(await discardAllKinds(), Array(3).fill("recovery_required"));
      assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
      assert.deepStrictEqual(storage.keys().map((key) => storage.get(key)), persisted);
    });
  }

  test("comment/newTicketの複合identity不一致は永続化せず、単一identityの互換性を維持する", async () => {
    await replaceOfflineSyncQueueAsync(queuedOperations(), scope);
    const before = getOfflineSyncQueue(scope);
    const writeCount = writes;
    for (const key of [
      { ticketId, commentId: 20, documentUri },
      { ticketId, commentId: 10, documentUri: "file:///tmp/other.md" },
      { ticketId: ticketId + 1, commentId: 10, documentUri },
    ]) {
      assert.strictEqual(await discardOfflineCommentUpdateAsync(key, scope), "not_found");
    }
    for (const key of [
      {}, { queueId: "wrong", documentUri },
      { queueId: "new-recovery", documentUri: "file:///tmp/other.md" },
    ]) {
      assert.strictEqual(await discardOfflineNewTicketAsync(key, scope), "not_found");
    }
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, commentId: 10, documentUri }, "missing-scope"), "not_found");
    assert.strictEqual(await discardOfflineNewTicketAsync({ queueId: "new-recovery", documentUri }, "missing-scope"), "not_found");
    assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
    assert.strictEqual(writes, writeCount);
    for (const key of [{ ticketId, commentId: 10 }, { ticketId, documentUri }]) {
      await replaceOfflineSyncQueueAsync(queuedOperations(), scope);
      assert.strictEqual(await discardOfflineCommentUpdateAsync(key, scope), "discarded");
    }
    for (const key of [
      { queueId: "new-recovery" }, { documentUri },
      { queueId: "new-recovery", documentUri: "file:///tmp/recovery%2Dcomment.md" },
    ]) {
      await replaceOfflineSyncQueueAsync(queuedOperations(), scope);
      assert.strictEqual(await discardOfflineNewTicketAsync(key, scope), "discarded");
    }
  });

  for (const key of keys) {
    for (const outcome of ["recovery_required", "discarded_next", "not_found", "discarded"] as const) {
      test(`Dashboard ${key.kind} 直接要求: ${outcome}を正しく通知する`, async () => {
        const unsafe = outcome === "recovery_required" || outcome === "discarded_next";
        await replaceOfflineSyncQueueAsync(queuedOperations(unsafe ? [effect({ state: "committed" })] : [], outcome === "discarded_next"), scope);
        const before = getOfflineSyncQueue(scope);
        const errors: string[] = [];
        const successes: string[] = [];
        const warningArguments: unknown[][] = [];
        const store = new DashboardStateStore();
        const controller = new DashboardController({
          store, notifyOperationStarted: () => {},
          notifySuccess: (_id, message) => { successes.push(message); },
          notifyError: (_id, message) => { errors.push(message); },
          notifyToast: () => {}, onTicketsRefreshed: () => {},
        });
        controller.refreshUnsyncedPresentation();
        const original = vscode.window.showWarningMessage;
        Object.defineProperty(vscode.window, "showWarningMessage", {
          configurable: true, writable: true, value: async (...args: unknown[]) => {
            warningArguments.push(args);
            if (outcome === "not_found") {
              // Dashboard表示後、確認ダイアログ中に同期などで対象がなくなる。
              await replaceOfflineSyncQueueAsync({ tickets: new Map(), comments: [], newTickets: [] }, scope);
            }
            return vscode.l10n.t(outcome === "discarded_next" ? "Discard later changes" : "Discard");
          },
        });
        try {
          await new DashboardMessageRouter(controller).route({ type: "unsynced.discardOne", requestId: "discard", key });
        } finally {
          vscode.window.showWarningMessage = original;
          controller.dispose();
        }
        if (outcome === "recovery_required") {
          assert.strictEqual(warningArguments.length, 0, "破棄不可の項目に全体破棄の確認を表示しない");
          assert.strictEqual(errors.length, 1);
          assert.deepStrictEqual(successes, []);
          assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
        } else if (outcome === "not_found") {
          assert.strictEqual(warningArguments.length, 1);
          assert.strictEqual(warningArguments[0][0], vscode.l10n.t("This will discard the unsynced local changes. The ticket on the Redmine server will not be deleted."));
          assert.strictEqual(warningArguments[0][2], vscode.l10n.t("Discard"));
          assert.deepStrictEqual(errors, [vscode.l10n.t("The unsynced item changed. Refresh and try again.")]);
          assert.deepStrictEqual(successes, []);
          assert.deepStrictEqual(store.getState().unsynced, { items: [], totalCount: 0, abandonedItems: [] });
        } else {
          assert.strictEqual(warningArguments.length, 1);
          assert.strictEqual(warningArguments[0][0], vscode.l10n.t(outcome === "discarded_next"
            ? "This will discard only the later local changes. The remote sync checkpoint will remain for review."
            : "This will discard the unsynced local changes. The ticket on the Redmine server will not be deleted."));
          assert.strictEqual(warningArguments[0][2], vscode.l10n.t(outcome === "discarded_next" ? "Discard later changes" : "Discard"));
          assert.deepStrictEqual(errors, []);
          assert.deepStrictEqual(successes, [vscode.l10n.t(outcome === "discarded_next"
            ? "Later local changes discarded. The remote sync checkpoint was preserved."
            : "Unsynced local changes discarded.")]);
          if (outcome === "discarded_next") {
            const after = getOfflineSyncQueue(scope);
            assert.deepStrictEqual(withoutNextIntents(after), withoutNextIntents(before));
            const active = key.kind === "ticket" ? after.tickets.get(ticketId)! : key.kind === "comment" ? after.comments[0] : after.newTickets[0];
            assert.strictEqual(active.nextIntent, undefined);
          }
        }
      });
    }
  }

  for (const key of keys) {
    test(`Dashboard ${key.kind}: 確認中に nextIntent が昇格したら stale として全内容を保持する`, async () => {
      const queue = queuedOperations([], true);
      queue.tickets.get(ticketId)!.phase = "preparing";
      queue.comments[0].phase = "preparing";
      queue.newTickets[0].phase = "preparing";
      for (const item of [queue.tickets.get(ticketId)!, queue.comments[0], queue.newTickets[0]]) {
        item.operationId = "confirm-operation";
      }
      await replaceOfflineSyncQueueAsync(queue, scope);
      const errors: string[] = [];
      const successes: string[] = [];
      const store = new DashboardStateStore();
      const controller = new DashboardController({
        store, notifyOperationStarted: () => {},
        notifySuccess: (_id, message) => { successes.push(message); },
        notifyError: (_id, message) => { errors.push(message); },
        notifyToast: () => {}, onTicketsRefreshed: () => {},
      });
      let afterTransition: OfflineSyncQueue | undefined;
      let writeCount = 0;
      let confirmations = 0;
      const original = vscode.window.showWarningMessage;
      Object.defineProperty(vscode.window, "showWarningMessage", {
        configurable: true, writable: true, value: async (...args: unknown[]) => {
          confirmations++;
          assert.strictEqual(args[2], vscode.l10n.t("Discard later changes"));
          const expected = { operationId: "confirm-operation", revision: 4, attemptGeneration: 2, sourcePhase: "preparing" as const };
          const action = { kind: "abort_before_remote_write" as const };
          const transitioned = key.kind === "ticket"
            ? await transitionOfflineTicketUpdateLifecycleAsync(ticketId, action, scope, expected)
            : key.kind === "newTicket"
              ? await transitionOfflineNewTicketLifecycleAsync(key, action, scope, expected)
              : await transitionOfflineCommentLifecycleAsync(key, action, scope, expected);
          assert.ok(transitioned);
          assert.strictEqual(transitioned.phase, "queued");
          assert.strictEqual(transitioned.nextIntent, undefined);
          afterTransition = getOfflineSyncQueue(scope);
          writeCount = writes;
          return vscode.l10n.t("Discard later changes");
        },
      });
      try {
        await new DashboardMessageRouter(controller).route({ type: "unsynced.discardOne", requestId: "discard", key });
      } finally {
        vscode.window.showWarningMessage = original;
        controller.dispose();
      }
      assert.strictEqual(confirmations, 1);
      assert.deepStrictEqual(errors, [vscode.l10n.t("The unsynced item changed. Refresh and try again.")]);
      assert.deepStrictEqual(successes, []);
      assert.deepStrictEqual(getOfflineSyncQueue(scope), afterTransition);
      assert.strictEqual(store.getState().unsynced.totalCount, 3);
      assert.strictEqual(writes, writeCount, "stale の破棄は永続化しない");
    });
  }

  for (const field of ["operationId", "revision", "intentRevision", "attemptGeneration", "nextIntent", "effects"] as const) {
    test(`Store: 確認後の ${field} 変更は同じ discardMode でも stale となる`, async () => {
      await replaceOfflineSyncQueueAsync(queuedOperations([effect({ state: "committed" })], true), scope);
      const plans = keys.map((key) => prepareOfflineDiscard(key, scope));
      const changed = getOfflineSyncQueue(scope);
      for (const item of [changed.tickets.get(ticketId)!, changed.comments[0], changed.newTickets[0]]) {
        switch (field) {
          case "operationId": item.operationId = "replacement"; break;
          case "revision": item.revision = 9; break;
          case "intentRevision":
            if ("ticketId" in item) { item.intentRevision = 9; }
            else { item.content = "Edited without revision change"; }
            break;
          case "attemptGeneration": item.attemptGeneration = 9; break;
          case "nextIntent": item.nextIntent!.revision = 9; break;
          case "effects": item.effects![0].remoteId = 99; break;
        }
      }
      await replaceOfflineSyncQueueAsync(changed, scope);
      const before = getOfflineSyncQueue(scope);
      const writeCount = writes;
      for (const plan of plans) {
        assert.strictEqual(plan.mode, "nextIntent");
        assert.strictEqual(await commitOfflineDiscardAsync(plan), "stale");
      }
      assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
      assert.strictEqual(writes, writeCount);
    });
  }

  test("Store: 同一 revision の queued 編集と削除後の対象追加を確認済みとして扱わない", async () => {
    await replaceOfflineSyncQueueAsync(queuedOperations(), scope);
    const plans = keys.map((key) => prepareOfflineDiscard(key, scope));
    await addOfflineTicketUpdateAsync(ticketId, { ...update, subject: "Newer edit" }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, commentId: 10, documentUri, body: "Newer comment" }, scope);
    await addOfflineNewTicketAsync({ queueId: "new-recovery", documentUri, content: "Newer draft" }, scope);
    const before = getOfflineSyncQueue(scope);
    const writeCount = writes;
    for (const plan of plans) {
      assert.strictEqual(await commitOfflineDiscardAsync(plan), "stale");
    }
    assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
    assert.strictEqual(writes, writeCount);
    const missing = prepareOfflineDiscard({ kind: "newTicket", queueId: "later" }, scope);
    await addOfflineNewTicketAsync({ queueId: "later", content: "Added after preparation" }, scope);
    const afterAdd = getOfflineSyncQueue(scope);
    const afterAddWrites = writes;
    assert.strictEqual(await commitOfflineDiscardAsync(missing), "not_found");
    assert.deepStrictEqual(getOfflineSyncQueue(scope), afterAdd);
    assert.strictEqual(writes, afterAddWrites);
  });

  for (const confirm of [false, true]) {
    for (const hasNext of [false, true]) {
      test(`Dashboard newTicket URI alias: nextIntent=${hasNext}, confirm=${confirm} で同一対象を確認する`, async () => {
        await replaceOfflineSyncQueueAsync(queuedOperations(hasNext ? [effect({ state: "committed" })] : [], hasNext), scope);
        const before = getOfflineSyncQueue(scope);
        const writeCount = writes;
        const errors: string[] = [];
        const successes: string[] = [];
        const controller = new DashboardController({
          store: new DashboardStateStore(), notifyOperationStarted: () => {},
          notifySuccess: (_id, message) => { successes.push(message); },
          notifyError: (_id, message) => { errors.push(message); },
          notifyToast: () => {}, onTicketsRefreshed: () => {},
        });
        let confirmations = 0;
        const label = vscode.l10n.t(hasNext ? "Discard later changes" : "Discard");
        const original = vscode.window.showWarningMessage;
        Object.defineProperty(vscode.window, "showWarningMessage", {
          configurable: true, writable: true, value: async (...args: unknown[]) => {
            confirmations++;
            assert.strictEqual(args[2], label);
            return confirm ? label : undefined;
          },
        });
        try {
          await new DashboardMessageRouter(controller).route({
            type: "unsynced.discardOne", requestId: "alias",
            key: { kind: "newTicket", documentUri: "file:///tmp/recovery%2Dcomment.md" },
          });
        } finally {
          vscode.window.showWarningMessage = original;
          controller.dispose();
        }
        assert.strictEqual(confirmations, 1);
        assert.deepStrictEqual(errors, []);
        assert.strictEqual(successes.length, confirm ? 1 : 0);
        const expected = structuredClone(before);
        if (confirm) {
          if (hasNext) { expected.newTickets[0].nextIntent = undefined; }
          else { expected.newTickets = []; }
        }
        assert.deepStrictEqual(getOfflineSyncQueue(scope), expected);
        assert.strictEqual(writes, writeCount + (confirm ? 1 : 0));
      });
    }
  }

  for (const entry of syncLifecycleCases) {
    for (const hasNext of [false, true]) {
      test(`${entry.phase ?? "legacy"}, nextIntent=${hasNext}: 表示・破棄・再起動復元`, async () => {
        await replaceOfflineSyncQueueAsync({
          tickets: new Map([[ticketId, {
            ...update, phase: entry.phase, revision: 4, attemptGeneration: 2,
            nextIntent: hasNext ? { ...update, revision: 5, subject: "Later" } : undefined,
          }]]),
          comments: [{
            ticketId, documentUri, body: "Comment", phase: entry.phase, revision: 4, attemptGeneration: 2,
            nextIntent: hasNext ? { revision: 5, body: "Later comment" } : undefined,
          }],
          newTickets: [{
            queueId: "new-recovery", content: "New", revision: 4, attemptGeneration: 2,
            phase: entry.phase === "remote_committed" ? "remote_created" : entry.phase,
            nextIntent: hasNext ? { revision: 5, content: "Later new" } : undefined,
          }],
        }, scope);
        const before = getOfflineSyncQueue(scope);
        const items = buildUnsyncedDashboardItems();
        assert.strictEqual(items.length, 3);
        for (const item of items) {
          assert.strictEqual(item.lifecycle, entry.lifecycle);
          assert.strictEqual(item.canDiscard, entry.canDiscard || hasNext);
          assert.strictEqual(item.discardMode, entry.canDiscard ? "active" : hasNext ? "nextIntent" : "none");
          assert.strictEqual(item.canSync, true);
        }
        assert.strictEqual(resolveTicketSyncState(ticketId), entry.state);
        if (!entry.canDiscard) {
          initializeTicketDraft(ticketId, "Base", "Base body", metadata, "", scope);
          for (const status of ["Synced", "Queued", "Dirty", "Failed", "Conflict"] as const) {
            markDraftStatus(ticketId, status, scope);
            assert.strictEqual(resolveTicketSyncState(ticketId), entry.state);
          }
          markDraftStatus(ticketId, "Syncing", scope);
          assert.strictEqual(resolveTicketSyncState(ticketId), "Syncing");
        }
        const writeCount = writes;
        const expected = entry.canDiscard ? "discarded" : hasNext ? "discarded_next" : "recovery_required";
        assert.strictEqual(await discardOfflineTicketUpdateAsync(ticketId, scope), expected);
        assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), expected);
        assert.strictEqual(await discardOfflineNewTicketAsync({ queueId: "new-recovery" }, scope), expected);
        if (expected === "recovery_required") {
          assert.strictEqual(writes, writeCount, "拒否した破棄は永続化しない");
          assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
        }
        const after = getOfflineSyncQueue(scope);
        if (entry.canDiscard) {
          assert.strictEqual(after.tickets.size + after.comments.length + after.newTickets.length, 0);
        } else {
          const withoutNext = <T extends { nextIntent?: unknown }>(value: T): T => ({ ...value, nextIntent: undefined });
          assert.deepStrictEqual(withoutNext(after.tickets.get(ticketId)!), withoutNext(before.tickets.get(ticketId)!));
          assert.deepStrictEqual(withoutNext(after.comments[0]), withoutNext(before.comments[0]));
          assert.deepStrictEqual(withoutNext(after.newTickets[0]), withoutNext(before.newTickets[0]));
          if (hasNext) {
            assert.strictEqual(after.tickets.get(ticketId)?.nextIntent, undefined);
            assert.strictEqual(after.comments[0].nextIntent, undefined);
            assert.strictEqual(after.newTickets[0].nextIntent, undefined);
          }
        }
        initializeOfflineSyncStore(storage, scope);
        const restoredItems = buildUnsyncedDashboardItems();
        assert.strictEqual(restoredItems.length, entry.canDiscard ? 0 : 3);
        for (const item of restoredItems) {
          // remote write 前の preparing は既存仕様に従い再起動時に queued へ戻る。
          assert.strictEqual(item.lifecycle, entry.phase === "preparing" ? "queued" : entry.lifecycle);
        }
        if (!entry.canDiscard) {
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.revision, before.tickets.get(ticketId)?.revision);
          assert.strictEqual(getOfflineSyncQueue(scope).comments[0].body, before.comments[0].body);
          assert.strictEqual(getOfflineSyncQueue(scope).newTickets[0].content, before.newTickets[0].content);
        }
      });
    }
  }

  test("コメントのURI・ticketId・接続scopeで別の下書きを破棄しない", async () => {
    await addOfflineCommentUpdateAsync({ ticketId, body: "First", documentUri }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, body: "Second", documentUri: "file:///tmp/other.md" }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, body: "Other scope", documentUri }, "other-scope");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId: ticketId + 1, documentUri }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri: "file:///tmp/missing.md" }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), "discarded");
    assert.deepStrictEqual(getOfflineSyncQueue(scope).comments.map((item) => item.body), ["Second"]);
    assert.strictEqual(getOfflineSyncQueue("other-scope").comments[0].body, "Other scope");
  });


  for (const kind of ["ticket", "comment"] as const) {
    test(`Dashboard ${kind} の直接破棄要求でも復旧チェックポイントを保護する`, async () => {
      await addOfflineTicketUpdateAsync(ticketId, { ...update, phase: "commit_unknown" }, scope);
      await addOfflineCommentUpdateAsync({ ticketId, documentUri, body: "Comment", phase: "commit_unknown" }, scope);
      const before = getOfflineSyncQueue(scope);
      const errors: string[] = [];
      const service = new DashboardUnsyncedService({
        context: {
          store: new DashboardStateStore(), notifyOperationStarted: () => {},
          notifySuccess: () => { assert.fail("復旧対象の破棄は成功しない"); },
          notifyError: (_id, message) => { errors.push(message); },
          notifyToast: () => {}, onTicketsRefreshed: () => {},
        },
        refreshTicketPresentation: () => {}, loadComments: async () => {},
      });
      const original = vscode.window.showWarningMessage;
      Object.defineProperty(vscode.window, "showWarningMessage", { configurable: true, writable: true, value: async () => vscode.l10n.t("Discard") });
      try {
        await service.handleDiscardOne("discard", kind === "ticket" ? { kind, ticketId } : { kind, ticketId, documentUri });
      } finally {
        vscode.window.showWarningMessage = original;
      }
      assert.strictEqual(errors.length, 1);
      assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
    });
  }

  test("破棄の永続化が失敗した場合は追加編集を含めて保持する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, { ...update, phase: "commit_unknown", nextIntent: { ...update, revision: 2 } }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, documentUri, body: "Comment", phase: "commit_unknown", nextIntent: { body: "Later", revision: 2 } }, scope);
    const before = getOfflineSyncQueue(scope);
    storage.update = async () => { throw new Error("injected persistence failure"); };
    assert.strictEqual(await discardOfflineTicketUpdateAsync(ticketId, scope), "recovery_required");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), "recovery_required");
    assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
  });
});
