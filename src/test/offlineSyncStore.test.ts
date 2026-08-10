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
});
