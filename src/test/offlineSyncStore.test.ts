import * as assert from "assert";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
  addOfflineCommentUpdate,
  addOfflineNewTicket,
  clearOfflineSyncQueue,
  replaceOfflineSyncQueue,
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
});
