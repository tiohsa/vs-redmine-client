import * as assert from "assert";
import type * as vscode from "vscode";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  removeOfflineTicketUpdateAsync,
  replaceOfflineSyncQueueAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
  updateOfflineTicketUpdateAsync,
  type OfflineSyncQueue,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

type WriteGate = {
  entered: Promise<void>;
  release: () => void;
};

class ControlledMemento implements vscode.Memento {
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
