import * as assert from "assert";
import type * as vscode from "vscode";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  cancelQueuedTicketUpdateIfMatchesAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  onOfflineSyncQueueChanged,
  removeOfflineTicketUpdateAsync,
  replaceOfflineSyncQueueAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
  updateOfflineTicketUpdateAsync,
  type OfflineSyncQueue,
  type OfflineTicketUpdate,
  type QueuedTicketCancellationExpectation,
} from "../views/offlineSyncStore";
import type { DurableSyncEffect, DurableSyncEffectState } from "../app/syncEffects";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

type WriteGate = {
  entered: Promise<void>;
  release: () => void;
};

class ControlledMemento implements vscode.Memento {
  public writeCount = 0;
  private readonly values = new Map<string, unknown>();
  private nextGate?: {
    key: string;
    entered: () => void;
    wait: Promise<void>;
  };
  private failNextKey?: string;

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }

  public keys(): readonly string[] {
    return Array.from(this.values.keys());
  }

  public blockNextWrite(key: string): WriteGate {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.nextGate = { key, entered, wait };
    return { entered: enteredPromise, release };
  }

  public rejectNextWrite(key: string): void {
    this.failNextKey = key;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.writeCount += 1;
    const gate = this.nextGate?.key === key ? this.nextGate : undefined;
    if (gate) {
      this.nextGate = undefined;
      gate.entered();
      await gate.wait;
    }
    if (this.failNextKey === key) {
      this.failNextKey = undefined;
      throw new Error("injected persistence failure");
    }
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, JSON.parse(JSON.stringify(value)));
    }
  }
}

const scopeKey = (scope: string): string =>
  `redmine.offlineSyncQueue.${encodeURIComponent(scope)}`;

const ticketUpdate = (
  ticketId: number,
  overrides: Partial<OfflineTicketUpdate> = {},
): OfflineTicketUpdate => ({
  ticketId,
  operationId: `ticket:${ticketId}`,
  phase: "queued",
  revision: 1,
  baseSubject: `Base ${ticketId}`,
  baseDescription: `Base body ${ticketId}`,
  baseMetadata: buildIssueMetadataFixture(),
  subject: `Subject ${ticketId}`,
  description: `Body ${ticketId}`,
  metadata: buildIssueMetadataFixture(),
  ...overrides,
});

const cancellationExpectation = (update: OfflineTicketUpdate): QueuedTicketCancellationExpectation => ({
  operationId: update.operationId,
  revision: update.revision ?? 1,
  intentRevision: update.intentRevision ?? update.revision ?? 1,
  content: update.content,
  connectionScope: update.connectionScope,
});

suite("offlineSyncStore queued cancellation CAS", () => {
  const scope = "queued-cancellation";
  const effect = (state: DurableSyncEffectState): DurableSyncEffect => ({
    effectId: "child-create:0",
    kind: "child_create",
    operationRevision: 1,
    attemptGeneration: 1,
    state,
    target: { parentTicketId: 1 },
  });
  let storage: ControlledMemento;

  setup(() => {
    storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
  });

  const seed = async (overrides: Partial<OfflineTicketUpdate> = {}): Promise<OfflineTicketUpdate> => {
    const update = ticketUpdate(1, {
      connectionScope: scope,
      intentRevision: 1,
      content: "Queued content",
      ...overrides,
    });
    await replaceOfflineSyncQueueAsync({
      tickets: new Map([[1, update]]), comments: [], newTickets: [],
    }, scope);
    return update;
  };

  for (const effects of [undefined, [], [effect("planned")]]) {
    test(`effects=${JSON.stringify(effects)} の安全な queue を永続化後に取り消す`, async () => {
      const update = await seed({ effects });
      await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
      const gate = storage.blockNextWrite(scopeKey(scope));
      let notifications = 0;
      const unsubscribe = onOfflineSyncQueueChanged(() => { notifications += 1; });
      try {
        const cancellation = cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope);
        await gate.entered;
        try {
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(1), true);
          assert.strictEqual(notifications, 0);
        } finally {
          gate.release();
        }
        assert.strictEqual(await cancellation, "cancelled");
        assert.strictEqual(notifications, 1);
        assert.deepStrictEqual([...getOfflineSyncQueue(scope).tickets.keys()], [2]);
        initializeOfflineSyncStore(storage, scope);
        assert.deepStrictEqual([...getOfflineSyncQueue(scope).tickets.keys()], [2]);
      } finally {
        unsubscribe();
      }
    });
  }

  test("legacy の省略された intentRevision と scope は snapshot の既定値で比較する", async () => {
    const update = await seed({ intentRevision: undefined, connectionScope: undefined, content: undefined });
    assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope), "cancelled");
  });

  test("存在しない ticket は通知・永続化しない", async () => {
    let notifications = 0;
    const unsubscribe = onOfflineSyncQueueChanged(() => { notifications += 1; });
    const writes = storage.writeCount;
    try {
      assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, { revision: 1, intentRevision: 1 }, scope), "not_found");
      assert.strictEqual(storage.writeCount, writes);
      assert.strictEqual(notifications, 0);
    } finally {
      unsubscribe();
    }
  });

  const staleExpectations: Partial<QueuedTicketCancellationExpectation>[] = [
    { operationId: "old-operation" },
    { operationId: undefined },
    { revision: 2 },
    { intentRevision: 2 },
    { content: "Old content" },
    { content: undefined },
    { connectionScope: "another-scope" },
    { connectionScope: undefined },
  ];
  for (const mismatch of staleExpectations) {
    test(`CAS不一致 ${Object.keys(mismatch).join()}=${JSON.stringify(mismatch)} は書き込まない`, async () => {
      const update = await seed();
      const before = getOfflineSyncQueue(scope);
      const writes = storage.writeCount;
      assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, {
        ...cancellationExpectation(update), ...mismatch,
      }, scope), "stale");
      assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
      assert.strictEqual(storage.writeCount, writes);
    });
  }

  test("nextIntent は新しい intent として stale で保護する", async () => {
    const update = await seed({ nextIntent: {
      revision: 2, subject: "Next", description: "Next body", metadata: buildIssueMetadataFixture(),
    } });
    const writes = storage.writeCount;
    assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope), "stale");
    assert.deepStrictEqual(getOfflineSyncQueue(scope).tickets.get(1), update);
    assert.strictEqual(storage.writeCount, writes);
  });

  const unsafeUpdates: Partial<OfflineTicketUpdate>[] = [
    ...([undefined, "preparing", "remote_write_started", "commit_unknown", "remote_committed",
      "reconciliation_pending", "local_finalize_pending", "completed"] as const).map((phase) => ({ phase })),
    ...(["started", "committed", "commit_unknown", "compensation_started", "compensation_unknown",
      "failed", "compensated"] as const).map((state) => ({ effects: [effect(state)] })),
    { attemptGeneration: 2, effects: [effect("committed")] },
    { remoteUpdatedAt: "2026-09-22T00:00:00Z" },
    { createdChildIds: [101] },
    { effects: [{ ...effect("planned"), remoteId: 101 }] },
    { effects: [{ ...effect("planned"), token: "remote-upload-token" }] },
  ];
  for (const unsafe of unsafeUpdates) {
    test(`remote 副作用を否定できない operation は保護する: ${JSON.stringify(unsafe)}`, async () => {
      const update = await seed(unsafe);
      const writes = storage.writeCount;
      assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope), "recovery_required");
      assert.deepStrictEqual(getOfflineSyncQueue(scope).tickets.get(1), update);
      assert.strictEqual(storage.writeCount, writes);
    });
  }

  test("別 scope の同じ ticket と誤った scope を持つ operation を保護する", async () => {
    const update = await seed();
    const otherScope = "other-queued-cancellation";
    await replaceOfflineSyncQueueAsync({ tickets: new Map([[1, update]]), comments: [], newTickets: [] }, otherScope);
    const writes = storage.writeCount;
    assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), otherScope), "stale");
    assert.deepStrictEqual(getOfflineSyncQueue(scope).tickets.get(1), update);
    assert.deepStrictEqual(getOfflineSyncQueue(otherScope).tickets.get(1), update);
    assert.strictEqual(storage.writeCount, writes);
  });

  test("永続化待ちの並行 save 後に最新 queue を再読込し stale とする", async () => {
    const update = await seed();
    const gate = storage.blockNextWrite(scopeKey(scope));
    const save = addOfflineTicketUpdateAsync(1, { ...update, content: "Newer content" }, scope);
    await gate.entered;
    const cancellation = cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope);
    const writes = storage.writeCount;
    gate.release();
    await save;
    assert.strictEqual(await cancellation, "stale");
    assert.strictEqual(storage.writeCount, writes);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(1)?.content, "Newer content");
    initializeOfflineSyncStore(storage, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(1)?.content, "Newer content");
  });

  test("並行 lifecycle 開始後は取消せず recovery_required とする", async () => {
    const update = await seed();
    const gate = storage.blockNextWrite(scopeKey(scope));
    const lifecycle = transitionOfflineTicketUpdateLifecycleAsync(1, { kind: "begin_preparation" }, scope, {
      operationId: "ticket:1", revision: 1, sourcePhase: "queued",
    });
    await gate.entered;
    const cancellation = cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope);
    const writes = storage.writeCount;
    gate.release();
    await lifecycle;
    assert.strictEqual(await cancellation, "recovery_required");
    assert.strictEqual(storage.writeCount, writes);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(1)?.phase, "preparing");
  });

  test("取消の永続化失敗は live memory と durable queue を保持する", async () => {
    const update = await seed();
    storage.rejectNextWrite(scopeKey(scope));
    let notifications = 0;
    const unsubscribe = onOfflineSyncQueueChanged(() => { notifications += 1; });
    try {
      assert.strictEqual(await cancelQueuedTicketUpdateIfMatchesAsync(1, cancellationExpectation(update), scope), "recovery_required");
      assert.deepStrictEqual(getOfflineSyncQueue(scope).tickets.get(1), update);
      assert.strictEqual(notifications, 0);
      initializeOfflineSyncStore(storage, scope);
      assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(1)?.content, update.content);
    } finally {
      unsubscribe();
    }
  });
});

suite("offlineSyncStore serializable transaction", () => {
  test("T01 lifecycle と別 ticket save の両方を保持する", async () => {
    const scope = "transaction-t01";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    const gate = storage.blockNextWrite(scopeKey(scope));

    const lifecycle = transitionOfflineTicketUpdateLifecycleAsync(
      1,
      { kind: "begin_preparation" },
      scope,
      { operationId: "ticket:1", revision: 1, sourcePhase: "queued" },
    );
    await gate.entered;
    const save = addOfflineTicketUpdateAsync(2, ticketUpdate(2, { subject: "Saved later" }), scope);
    gate.release();
    await Promise.all([lifecycle, save]);

    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.get(1)?.phase, "preparing");
    assert.strictEqual(queue.tickets.get(2)?.subject, "Saved later");
  });

  test("T02 lifecycle と comment save の両方を保持する", async () => {
    const scope = "transaction-t02";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    const gate = storage.blockNextWrite(scopeKey(scope));

    const lifecycle = transitionOfflineTicketUpdateLifecycleAsync(
      1,
      { kind: "begin_preparation" },
      scope,
      { operationId: "ticket:1", revision: 1, sourcePhase: "queued" },
    );
    await gate.entered;
    const commentSave = addOfflineCommentUpdateAsync({ ticketId: 1, body: "comment" }, scope);
    gate.release();
    await Promise.all([lifecycle, commentSave]);

    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.get(1)?.phase, "preparing");
    assert.strictEqual(queue.comments[0]?.body, "comment");
  });

  test("T03 complete と別 operation update の両方を保持する", async () => {
    const scope = "transaction-t03";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    const gate = storage.blockNextWrite(scopeKey(scope));

    const completion = completeOfflineTicketUpdateAsync(1, scope, undefined, 1);
    await gate.entered;
    const update = addOfflineTicketUpdateAsync(2, ticketUpdate(2, { description: "new intent" }), scope);
    gate.release();
    await Promise.all([completion, update]);

    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.has(1), false);
    assert.strictEqual(queue.tickets.get(2)?.description, "new intent");
  });

  test("T04 remove と別 operation update の両方を保持する", async () => {
    const scope = "transaction-t04";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    const gate = storage.blockNextWrite(scopeKey(scope));

    const removal = removeOfflineTicketUpdateAsync(1, scope);
    await gate.entered;
    const update = addOfflineTicketUpdateAsync(2, ticketUpdate(2, { subject: "updated" }), scope);
    gate.release();
    await Promise.all([removal, update]);

    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.has(1), false);
    assert.strictEqual(queue.tickets.get(2)?.subject, "updated");
  });

  test("T05 同一 scope の async mutation は直列順序と等価になる", async () => {
    const scope = "transaction-t05";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    const gate = storage.blockNextWrite(scopeKey(scope));
    let secondCompleted = false;

    const first = addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    await gate.entered;
    const second = addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    void second.then(() => { secondCompleted = true; });
    await Promise.resolve();
    assert.strictEqual(secondCompleted, false);
    gate.release();
    await Promise.all([first, second]);

    assert.deepStrictEqual(
      Array.from(getOfflineSyncQueue(scope).tickets.keys()).sort(),
      [1, 2],
    );
  });

  test("T07 最初の persistence failure は candidate を公開しない", async () => {
    const scope = "transaction-t07";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    storage.rejectNextWrite(scopeKey(scope));

    await assert.rejects(addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope));
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);

    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(1), false);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(2), true);
    initializeOfflineSyncStore(storage, scope);
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue(scope).tickets.keys()), [2]);
  });

  test("T08 二番目の persistence failure は最初の commit を保持する", async () => {
    const scope = "transaction-t08";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    storage.rejectNextWrite(scopeKey(scope));

    await assert.rejects(addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope));

    assert.deepStrictEqual(Array.from(getOfflineSyncQueue(scope).tickets.keys()), [1]);
    initializeOfflineSyncStore(storage, scope);
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue(scope).tickets.keys()), [1]);
  });

  test("T09 並行 transaction 後の restart で同じ queue を復元する", async () => {
    const scope = "transaction-t09";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    const gate = storage.blockNextWrite(scopeKey(scope));
    const first = addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);
    await gate.entered;
    const second = addOfflineCommentUpdateAsync({ ticketId: 1, body: "durable" }, scope);
    gate.release();
    await Promise.all([first, second]);
    const before = getOfflineSyncQueue(scope);

    initializeOfflineSyncStore(storage, scope);
    const restored = getOfflineSyncQueue(scope);
    assert.strictEqual(restored.tickets.size, before.tickets.size);
    assert.strictEqual(restored.comments[0]?.body, before.comments[0]?.body);
  });

  test("T10 異なる scope の mutation は並行実行できる", async () => {
    const scopeA = "transaction-t10-a";
    const scopeB = "transaction-t10-b";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scopeA);
    const gate = storage.blockNextWrite(scopeKey(scopeA));

    const blockedA = addOfflineTicketUpdateAsync(1, ticketUpdate(1), scopeA);
    await gate.entered;
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2), scopeB);
    assert.strictEqual(getOfflineSyncQueue(scopeB).tickets.has(2), true);
    gate.release();
    await blockedA;
  });

  test("T11 同一 scope の lifecycle 再入は deadlock しない", async () => {
    const scope = "transaction-t11";
    initializeOfflineSyncStore(new ControlledMemento(), scope);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scope);

    const transitioned = await transitionOfflineTicketUpdateLifecycleAsync(
      1,
      { kind: "begin_preparation" },
      scope,
      { operationId: "ticket:1", revision: 1, sourcePhase: "queued" },
    );

    assert.strictEqual(transitioned?.phase, "preparing");
  });

  test("T12 並行 save で durable Effect ledger を消さない", async () => {
    const scope = "transaction-t12";
    const storage = new ControlledMemento();
    initializeOfflineSyncStore(storage, scope);
    const queue: OfflineSyncQueue = {
      tickets: new Map([[1, ticketUpdate(1, {
        phase: "remote_committed",
        effects: [{
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          target: { ticketId: 1 },
        }],
      })]]),
      comments: [],
      newTickets: [],
    };
    await replaceOfflineSyncQueueAsync(queue, scope);
    const gate = storage.blockNextWrite(scopeKey(scope));

    const lifecycle = updateOfflineTicketUpdateAsync(
      1,
      { phase: "reconciliation_pending" },
      scope,
      1,
    );
    await gate.entered;
    const save = addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    gate.release();
    await Promise.all([lifecycle, save]);

    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(1)?.effects?.[0]?.state, "committed");
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(2), true);
  });
});
