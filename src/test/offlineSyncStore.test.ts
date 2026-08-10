import * as assert from "assert";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
  addOfflineCommentUpdate,
  addOfflineNewTicket,
  addOfflineNewTicketAsync,
  clearOfflineSyncQueue,
  replaceOfflineSyncQueue,
  removeOfflineTicketUpdate,
  getOfflineSyncQueue,
  switchOfflineSyncStore,
  discardOfflineNewTicketAsync,
  discardOfflineTicketUpdateAsync,
  mergeOfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const ticketUpdate = (ticketId: number) => {
  const metadata = buildIssueMetadataFixture();
  return {
    ticketId,
    baseSubject: "Base",
    baseDescription: "Base body",
    baseMetadata: metadata,
    subject: "Updated",
    description: "Updated body",
    metadata,
  };
};

suite("offlineSyncStore — workspaceState 永続化", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento());
  });

  test("空の memento から初期化するとキューは空になる", () => {
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("チケット更新を追加後に同じ memento で再初期化するとデータが復元される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(123, ticketUpdate(123));

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.ok(q.tickets.has(123));
    assert.strictEqual(q.tickets.get(123)?.ticketId, 123);
  });

  test("commentId あり コメント更新を追加後に復元される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineCommentUpdate({
      ticketId: 10,
      commentId: 99,
      body: "comment body",
      documentUri: "file:///tmp/c.md",
    });

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.comments.length, 1);
    assert.strictEqual(q.comments[0].commentId, 99);
    assert.strictEqual(q.comments[0].ticketId, 10);
  });

  test("commentId なし（新規コメント）を追加後に復元される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineCommentUpdate({
      ticketId: 20,
      body: "new comment",
      documentUri: "file:///tmp/nc.md",
    });

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.comments.length, 1);
    assert.strictEqual(q.comments[0].commentId, undefined);
    assert.strictEqual(q.comments[0].ticketId, 20);
  });

  test("新規チケットを追加後に復元される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineNewTicket({ content: "# New ticket", documentUri: "file:///tmp/nt.md" });

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1);
    assert.strictEqual(q.newTickets[0].documentUri, "file:///tmp/nt.md");
  });

  test("clearOfflineSyncQueue 後に再初期化すると空のキューになる", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(1, ticketUpdate(1));
    addOfflineCommentUpdate({ ticketId: 1, body: "body" });
    addOfflineNewTicket({ content: "ticket", documentUri: "file:///tmp/t.md" });

    clearOfflineSyncQueue();

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("replaceOfflineSyncQueue 後に再初期化すると置換後のデータが復元される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(1, ticketUpdate(1));
    addOfflineTicketUpdate(2, ticketUpdate(2));

    replaceOfflineSyncQueue({
      tickets: new Map([[2, ticketUpdate(2)]]),
      comments: [],
      newTickets: [],
    });

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.ok(q.tickets.has(2));
    assert.ok(!q.tickets.has(1));
  });

  test("initializeOfflineSyncStore 未呼び出しでも変異関数が throw しない", () => {
    initializeOfflineSyncStore(createTestMemento());
    clearOfflineSyncQueue();

    assert.doesNotThrow(() => {
      addOfflineTicketUpdate(99, ticketUpdate(99));
      addOfflineCommentUpdate({ ticketId: 99, body: "body" });
      addOfflineNewTicket({ content: "ticket" });
      clearOfflineSyncQueue();
    });
  });

  test("不正データが保存されていても initializeOfflineSyncStore が throw せず空キューになる", () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: null,
      comments: "invalid",
      newTickets: 42,
    });

    assert.doesNotThrow(() => {
      initializeOfflineSyncStore(memento as unknown as import("vscode").Memento);
    });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("baseUrlごとに未送信キューを隔離し、切り戻しと再起動で復元する", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, "https://old.example/redmine");
    addOfflineTicketUpdate(1, ticketUpdate(1));

    switchOfflineSyncStore("https://new.example/redmine");
    assert.strictEqual(getOfflineSyncQueue().tickets.size, 0);
    addOfflineTicketUpdate(2, ticketUpdate(2));

    switchOfflineSyncStore("https://old.example/redmine");
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue().tickets.keys()), [1]);

    initializeOfflineSyncStore(memento, "https://new.example/redmine");
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue().tickets.keys()), [2]);
  });

  test("同一IDを持つ接続先別キューを明示スコープで独立操作する", () => {
    const memento = createTestMemento();
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeOfflineSyncStore(memento, scopeA);
    addOfflineTicketUpdate(1, { ...ticketUpdate(1), subject: "A" }, scopeA);
    addOfflineTicketUpdate(1, { ...ticketUpdate(1), subject: "B" }, scopeB);

    removeOfflineTicketUpdate(1, scopeA);

    assert.strictEqual(getOfflineSyncQueue(scopeA).tickets.has(1), false);
    assert.strictEqual(getOfflineSyncQueue(scopeB).tickets.get(1)?.subject, "B");
  });

  test("逆順で完了した旧接続先処理が現在接続先キューを削除しない", async () => {
    const memento = createTestMemento();
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeOfflineSyncStore(memento, scopeA);
    addOfflineTicketUpdate(1, ticketUpdate(1), scopeA);
    addOfflineTicketUpdate(1, ticketUpdate(1), scopeB);

    const oldCompletion = Promise.resolve().then(() => removeOfflineTicketUpdate(1, scopeA));
    switchOfflineSyncStore(scopeB);
    await oldCompletion;

    assert.strictEqual(getOfflineSyncQueue(scopeA).tickets.has(1), false);
    assert.strictEqual(getOfflineSyncQueue(scopeB).tickets.has(1), true);
  });

  test("旧形式キューを現在スコープへ移行し再起動後も復元する", () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[5, ticketUpdate(5)]],
      comments: [],
      newTickets: [],
    });
    const scope = "https://legacy.example/redmine/";

    initializeOfflineSyncStore(memento, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(5), true);
    initializeOfflineSyncStore(memento, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(5), true);
  });

  test("created_rewrite_failed の legacy entry を local_finalize_pending として復元する", () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [],
      comments: [],
      newTickets: [{
        queueId: "legacy-new-1",
        content: "# Ticket",
        createdIssueId: 88,
        status: "created_rewrite_failed",
      }],
    });

    initializeOfflineSyncStore(memento);
    const restored = getOfflineSyncQueue().newTickets[0];
    assert.strictEqual(restored.phase, "local_finalize_pending");
    assert.strictEqual(restored.operationId, "legacy-new-1");
  });

  test("async mutation は Memento.update 完了まで resolve しない", async () => {
    let release: (() => void) | undefined;
    const writes: unknown[] = [];
    const memento = {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      keys: (): readonly string[] => [],
      update: async (_key: string, value: unknown): Promise<void> => {
        writes.push(value);
        await new Promise<void>((resolve) => { release = resolve; });
      },
    };
    initializeOfflineSyncStore(memento as import("vscode").Memento, "scope-a");
    let completed = false;
    const pending = addOfflineNewTicketAsync(
      { content: "# Durable", connectionScope: "scope-a" },
      "scope-a",
    ).then(() => { completed = true; });

    await Promise.resolve();
    assert.strictEqual(completed, false);
    assert.strictEqual(writes.length, 1);
    release?.();
    await pending;
    assert.strictEqual(completed, true);
  });

  test("untitled/file URI variants は同一 document operation として扱う", () => {
    const stale = "untitled:/tmp/same-ticket.md";
    const saved = "file:///tmp/same-ticket.md";
    addOfflineNewTicket({
      content: "# First",
      documentUri: stale,
      createdIssueId: 321,
      phase: "local_finalize_pending",
    });
    const operationId = getOfflineSyncQueue().newTickets[0].operationId;

    addOfflineNewTicket({ content: "# Saved", documentUri: saved });
    const queue = getOfflineSyncQueue();
    assert.strictEqual(queue.newTickets.length, 1);
    assert.strictEqual(queue.newTickets[0].operationId, operationId);
    assert.strictEqual(queue.newTickets[0].createdIssueId, 321);
  });

  test("remote committed ticket update に後続 save が来ても pending phase を queued へ戻さない", () => {
    addOfflineTicketUpdate(901, {
      ...ticketUpdate(901),
      phase: "reconciliation_pending",
      operationId: "ticket-901",
    });
    addOfflineTicketUpdate(901, {
      ...ticketUpdate(901),
      description: "Saved while pending",
      phase: "queued",
    });

    const restored = getOfflineSyncQueue().tickets.get(901);
    assert.strictEqual(restored?.phase, "reconciliation_pending");
    assert.strictEqual(restored?.operationId, "ticket-901");
  });

  test("remote committed ticket update の active payload を後続 save が上書きしない", () => {
    addOfflineTicketUpdate(902, {
      ...ticketUpdate(902),
      description: "Already sent",
      phase: "reconciliation_pending",
      operationId: "ticket-902",
    });

    addOfflineTicketUpdate(902, {
      ...ticketUpdate(902),
      description: "Edited while reconciliation is pending",
      phase: "queued",
    });

    const operation = getOfflineSyncQueue().tickets.get(902);
    assert.strictEqual(operation?.description, "Already sent");
    assert.strictEqual(
      operation?.nextIntent?.description,
      "Edited while reconciliation is pending",
    );
    assert.ok((operation?.nextIntent?.revision ?? 0) > (operation?.revision ?? 0));
  });

  test("remote created new ticket の active content を後続 save が上書きしない", () => {
    addOfflineNewTicket({
      content: "# Already sent",
      documentUri: "file:///tmp/pending-new.md",
      createdIssueId: 903,
      phase: "local_finalize_pending",
    });
    const active = getOfflineSyncQueue().newTickets[0];

    addOfflineNewTicket({
      content: "# Edited while finalization is pending",
      documentUri: "file:///tmp/pending-new.md",
    });

    const operation = getOfflineSyncQueue().newTickets[0];
    assert.strictEqual(operation.content, "# Already sent");
    assert.strictEqual(operation.operationId, active.operationId);
    assert.strictEqual(
      operation.nextIntent?.content,
      "# Edited while finalization is pending",
    );
    assert.ok((operation.nextIntent?.revision ?? 0) > (operation.revision ?? 0));
  });

  test("同一 scope の fire-and-forget persistence を completion 順ではなく mutation 順に直列化する", async () => {
    const releases: Array<() => void> = [];
    let updateCalls = 0;
    const memento = {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      keys: (): readonly string[] => [],
      update: async (): Promise<void> => {
        updateCalls++;
        await new Promise<void>((resolve) => releases.push(resolve));
      },
    };
    initializeOfflineSyncStore(memento as import("vscode").Memento, "scope-serial");

    addOfflineTicketUpdate(1, ticketUpdate(1), "scope-serial");
    addOfflineTicketUpdate(2, ticketUpdate(2), "scope-serial");
    await Promise.resolve();

    assert.strictEqual(updateCalls, 1);
    releases.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(updateCalls, 2);
    releases.shift()?.();
  });

  test("remote-created new ticket の durable checkpoint は通常 discard で削除しない", async () => {
    addOfflineNewTicket({
      content: "# Created",
      documentUri: "file:///tmp/created-pending.md",
      createdIssueId: 910,
      phase: "local_finalize_pending",
    });

    const result = await discardOfflineNewTicketAsync(
      { documentUri: "file:///tmp/created-pending.md" },
      "",
    );

    assert.strictEqual(result, "recovery_required");
    assert.strictEqual(getOfflineSyncQueue().newTickets[0].createdIssueId, 910);
  });

  test("remote-committed ticket は後続 intent だけを discard して checkpoint を保持する", async () => {
    addOfflineTicketUpdate(911, {
      ...ticketUpdate(911),
      phase: "reconciliation_pending",
    });
    addOfflineTicketUpdate(911, {
      ...ticketUpdate(911),
      description: "Later edit",
    });

    const result = await discardOfflineTicketUpdateAsync(911, "");

    assert.strictEqual(result, "discarded_next");
    const operation = getOfflineSyncQueue().tickets.get(911);
    assert.strictEqual(operation?.phase, "reconciliation_pending");
    assert.strictEqual(operation?.nextIntent, undefined);
  });

  test("10,000回の後続saveをidentityあたりactive+nextの2 snapshotへcoalesceする", () => {
    let operation = mergeOfflineTicketUpdate(
      912,
      undefined,
      { ...ticketUpdate(912), phase: "reconciliation_pending" },
    );

    for (let revision = 1; revision <= 10_000; revision++) {
      operation = mergeOfflineTicketUpdate(912, operation, {
        ...ticketUpdate(912),
        description: `Later edit ${revision}`,
        phase: "queued",
      });
    }

    assert.strictEqual(operation.phase, "reconciliation_pending");
    assert.strictEqual(operation.description, "Updated body");
    assert.strictEqual(operation.nextIntent?.description, "Later edit 10000");
    assert.strictEqual(operation.nextIntent?.revision, 10_001);
    assert.strictEqual("nextIntent" in (operation.nextIntent ?? {}), false);
  });
});
