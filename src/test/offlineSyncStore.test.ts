import * as assert from "assert";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdateAsync,
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  clearOfflineSyncQueueAsync,
  replaceOfflineSyncQueueAsync,
  removeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  switchOfflineSyncStore,
  discardOfflineNewTicketAsync,
  discardOfflineTicketUpdateAsync,
  mergeOfflineTicketUpdate,
  updateOfflineNewTicketAsync,
  updateOfflineTicketUpdateAsync,
  abortOfflineNewTicketBeforeRemoteWriteAsync,
  abortOfflineTicketUpdateBeforeRemoteWriteAsync,
  completeOfflineTicketUpdateAsync,
  transitionOfflineNewTicketLifecycleAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
  listSyncOperations,
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
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento());
  });

  test("空の memento から初期化するとキューは空になる", async () => {
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("チケット更新を追加後に同じ memento で再初期化するとデータが復元される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(123, ticketUpdate(123));

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.ok(q.tickets.has(123));
    assert.strictEqual(q.tickets.get(123)?.ticketId, 123);
  });

  test("v3 永続形式は effects を envelope の単一sourceとして保存する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);
    await addOfflineTicketUpdateAsync(123, ticketUpdate(123));
    await addOfflineCommentUpdateAsync({ ticketId: 123, commentId: 8, body: "comment" });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const persisted = memento.get<{ version?: number; operations?: unknown[] }>("redmine.offlineSyncQueue");
    assert.strictEqual(persisted.version, 3);
    assert.strictEqual(persisted.operations?.length, 2);
    assert.deepStrictEqual(
      listSyncOperations().map((operation) => operation.kind).sort(),
      ["commentUpdate", "ticketUpdate"],
    );
    const operations = persisted.operations as Array<{
      effects?: unknown[];
      payload?: { effects?: unknown[] };
    }>;
    assert.ok(operations.every((operation) => Array.isArray(operation.effects)));
    assert.ok(operations.every((operation) => operation.payload?.effects === undefined));
  });

  test("v1 キューを読み込むと v2 操作モデルとして復元する", async () => {
    const memento = createTestMemento();
    await memento.update("redmine.offlineSyncQueue", {
      tickets: [[55, ticketUpdate(55)]],
      comments: [{ ticketId: 55, body: "legacy comment" }],
      newTickets: [],
    });

    initializeOfflineSyncStore(memento);
    assert.deepStrictEqual(
      listSyncOperations().map((operation) => operation.kind).sort(),
      ["commentCreate", "ticketUpdate"],
    );
    assert.strictEqual(getOfflineSyncQueue().tickets.get(55)?.subject, "Updated");
  });

  test("commentId あり コメント更新を追加後に復元される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineCommentUpdateAsync({
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

  test("commentId なし（新規コメント）を追加後に復元される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineCommentUpdateAsync({
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

  test("新規チケットを追加後に復元される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineNewTicketAsync({ content: "# New ticket", documentUri: "file:///tmp/nt.md" });

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1);
    assert.strictEqual(q.newTickets[0].documentUri, "file:///tmp/nt.md");
  });

  test("clearOfflineSyncQueueAsync 後に再初期化すると空のキューになる", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(1, ticketUpdate(1));
    await addOfflineCommentUpdateAsync({ ticketId: 1, body: "body" });
    await addOfflineNewTicketAsync({ content: "ticket", documentUri: "file:///tmp/t.md" });

    await clearOfflineSyncQueueAsync();

    initializeOfflineSyncStore(memento);
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("replaceOfflineSyncQueueAsync 後に再初期化すると置換後のデータが復元される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(1, ticketUpdate(1));
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2));

    await replaceOfflineSyncQueueAsync({
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

  test("initializeOfflineSyncStore 未呼び出しでも変異関数が throw しない", async () => {
    initializeOfflineSyncStore(createTestMemento());
    await clearOfflineSyncQueueAsync();

    await assert.doesNotReject(async () => {
      await addOfflineTicketUpdateAsync(99, ticketUpdate(99));
      await addOfflineCommentUpdateAsync({ ticketId: 99, body: "body" });
      await addOfflineNewTicketAsync({ content: "ticket" });
      await clearOfflineSyncQueueAsync();
    });
  });

  test("不正データが保存されていても initializeOfflineSyncStore が throw せず空キューになる", async () => {
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

  test("baseUrlごとに未送信キューを隔離し、切り戻しと再起動で復元する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, "https://old.example/redmine");
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1));

    switchOfflineSyncStore("https://new.example/redmine");
    assert.strictEqual(getOfflineSyncQueue().tickets.size, 0);
    await addOfflineTicketUpdateAsync(2, ticketUpdate(2));

    switchOfflineSyncStore("https://old.example/redmine");
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue().tickets.keys()), [1]);

    initializeOfflineSyncStore(memento, "https://new.example/redmine");
    assert.deepStrictEqual(Array.from(getOfflineSyncQueue().tickets.keys()), [2]);
  });

  test("同一IDを持つ接続先別キューを明示スコープで独立操作する", async () => {
    const memento = createTestMemento();
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeOfflineSyncStore(memento, scopeA);
    await addOfflineTicketUpdateAsync(1, { ...ticketUpdate(1), subject: "A" }, scopeA);
    await addOfflineTicketUpdateAsync(1, { ...ticketUpdate(1), subject: "B" }, scopeB);

    await removeOfflineTicketUpdateAsync(1, scopeA);

    assert.strictEqual(getOfflineSyncQueue(scopeA).tickets.has(1), false);
    assert.strictEqual(getOfflineSyncQueue(scopeB).tickets.get(1)?.subject, "B");
  });

  test("逆順で完了した旧接続先処理が現在接続先キューを削除しない", async () => {
    const memento = createTestMemento();
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeOfflineSyncStore(memento, scopeA);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scopeA);
    await addOfflineTicketUpdateAsync(1, ticketUpdate(1), scopeB);

    const oldCompletion = Promise.resolve().then(() => removeOfflineTicketUpdateAsync(1, scopeA));
    switchOfflineSyncStore(scopeB);
    await oldCompletion;

    assert.strictEqual(getOfflineSyncQueue(scopeA).tickets.has(1), false);
    assert.strictEqual(getOfflineSyncQueue(scopeB).tickets.has(1), true);
  });

  test("旧形式キューを現在スコープへ移行し再起動後も復元する", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[5, ticketUpdate(5)]],
      comments: [],
      newTickets: [],
    });
    const scope = "https://legacy.example/redmine/";

    initializeOfflineSyncStore(memento, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(5), true);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(5)?.operationId, "ticket:5");
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(5)?.revision, 1);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(5)?.phase, "queued");
    initializeOfflineSyncStore(memento, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(5), true);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(5)?.operationId, "ticket:5");
  });

  test("scoped legacy existing queue を canonical lifecycle operation として復元する", async () => {
    const memento = createTestMemento();
    const scope = "https://scoped-legacy.example/redmine/";
    void memento.update(`redmine.offlineSyncQueue.${encodeURIComponent(scope)}`, {
      tickets: [[6, ticketUpdate(6)]],
      comments: [],
      newTickets: [],
    });

    initializeOfflineSyncStore(memento, scope);

    const restored = getOfflineSyncQueue(scope).tickets.get(6);
    assert.strictEqual(restored?.operationId, "ticket:6");
    assert.strictEqual(restored?.revision, 1);
    assert.strictEqual(restored?.phase, "queued");
  });

  test("明示済み existing operationId は load normalization で変更しない", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[7, { ...ticketUpdate(7), operationId: "custom-operation", revision: 3 }]],
      comments: [],
      newTickets: [],
    });

    initializeOfflineSyncStore(memento);

    const restored = getOfflineSyncQueue().tickets.get(7);
    assert.strictEqual(restored?.operationId, "custom-operation");
    assert.strictEqual(restored?.revision, 3);
  });

  test("created_rewrite_failed の legacy entry を local_finalize_pending として復元する", async () => {
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

  test("legacy createdIssueId は committed parent effect として復元する", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [],
      comments: [],
      newTickets: [{
        queueId: "legacy-created",
        content: "# Ticket",
        createdIssueId: 88,
        status: "created_rewrite_failed",
      }],
    });

    initializeOfflineSyncStore(memento);
    const operation = listSyncOperations()[0];
    assert.deepStrictEqual(operation.effects, [{
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      target: {},
      remoteId: 88,
    }]);
  });

  test("legacy remote_write_started は primary effect の commit_unknown として復元する", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[9, { ...ticketUpdate(9), phase: "remote_write_started", revision: 2 }]],
      comments: [],
      newTickets: [],
    });

    initializeOfflineSyncStore(memento);
    const operation = listSyncOperations()[0];
    assert.strictEqual(operation.phase, "commit_unknown");
    assert.strictEqual(operation.effects.length, 1);
    assert.strictEqual(operation.effects[0].kind, "ticket_update");
    assert.strictEqual(operation.effects[0].operationRevision, 2);
    assert.strictEqual(operation.effects[0].state, "commit_unknown");
  });

  test("restart 時は preparing の後続 intent を queued active、remote_write_started を commit_unknown に正規化する", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[1, {
        ...ticketUpdate(1),
        phase: "preparing",
        revision: 4,
        nextIntent: { ...ticketUpdate(1), revision: 5, subject: "Latest", description: "Latest body" },
      }]],
      comments: [],
      newTickets: [{
        queueId: "started-new-ticket",
        content: "# Ticket",
        phase: "remote_write_started",
      }],
    });

    initializeOfflineSyncStore(memento);

    assert.strictEqual(getOfflineSyncQueue().tickets.get(1)?.phase, "queued");
    assert.strictEqual(getOfflineSyncQueue().tickets.get(1)?.subject, "Latest");
    assert.strictEqual(getOfflineSyncQueue().tickets.get(1)?.revision, 5);
    assert.strictEqual(getOfflineSyncQueue().tickets.get(1)?.nextIntent, undefined);
    assert.strictEqual(getOfflineSyncQueue().newTickets[0].phase, "commit_unknown");
  });

  test("I-14 restart は preparing 中に committed 済みの child effect を破棄しない", async () => {
    const memento = createTestMemento();
    const payload = ticketUpdate(21);
    void memento.update("redmine.offlineSyncQueue", {
      version: 3,
      operations: [{
        operationId: "ticket:21",
        kind: "ticketUpdate",
        connectionScope: "",
        revision: 3,
        phase: "preparing",
        createdAt: 1,
        effects: [{
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 3,
          state: "planned",
          target: { ticketId: 21 },
        }, {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 3,
          state: "committed",
          target: { parentTicketId: 21, ordinal: 0 },
          remoteId: 210,
        }, {
          effectId: "child-create:1",
          kind: "child_create",
          operationRevision: 3,
          state: "started",
          target: { parentTicketId: 21, ordinal: 1 },
        }],
        payload,
      }],
    });

    initializeOfflineSyncStore(memento);

    const restored = getOfflineSyncQueue().tickets.get(21);
    assert.strictEqual(restored?.phase, "preparing");
    assert.strictEqual(restored?.revision, 3);
    assert.strictEqual(restored?.effects?.[1]?.state, "committed");
    assert.strictEqual(restored?.effects?.[1]?.remoteId, 210);
    assert.strictEqual(restored?.effects?.[2]?.state, "commit_unknown");
  });

  test("restart は new-ticket の primary effect が不確定なまま queued に戻るのを防ぐ", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      version: 3,
      operations: [{
        operationId: "new-ticket-restart-unknown",
        kind: "ticketCreate",
        connectionScope: "",
        revision: 2,
        phase: "preparing",
        createdAt: 1,
        effects: [{
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 2,
          state: "started",
          target: {},
        }],
        payload: { content: "# Ticket" },
      }],
    });

    initializeOfflineSyncStore(memento);

    const restored = getOfflineSyncQueue().newTickets[0];
    assert.strictEqual(restored.phase, "commit_unknown");
    assert.strictEqual(restored.effects?.[0]?.state, "commit_unknown");
  });

  test("restart は new-comment の primary effect が不確定なまま queued に戻るのを防ぐ", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      version: 3,
      operations: [{
        operationId: "new-comment-restart-unknown",
        kind: "commentCreate",
        connectionScope: "",
        revision: 2,
        phase: "preparing",
        createdAt: 1,
        effects: [{
          effectId: "comment-create",
          kind: "comment_create",
          operationRevision: 2,
          state: "started",
          target: { ticketId: 42 },
        }],
        payload: { ticketId: 42, body: "comment" },
      }],
    });

    initializeOfflineSyncStore(memento);

    const restored = getOfflineSyncQueue().comments[0];
    assert.strictEqual(restored.phase, "commit_unknown");
    assert.strictEqual(restored.effects?.[0]?.state, "commit_unknown");
  });

  test("restart 時も commit_unknown active revision と later nextIntent をそのまま保持する", async () => {
    const memento = createTestMemento();
    void memento.update("redmine.offlineSyncQueue", {
      tickets: [[7, {
        ...ticketUpdate(7),
        description: "Active A",
        operationId: "ticket:7",
        phase: "commit_unknown",
        revision: 4,
        nextIntent: {
          revision: 5,
          subject: "Updated",
          description: "Later B",
          metadata: buildIssueMetadataFixture(),
        },
      }]],
      comments: [],
      newTickets: [{
        queueId: "restart-unknown-new",
        operationId: "restart-unknown-new",
        content: "Active A",
        phase: "commit_unknown",
        revision: 4,
        nextIntent: { revision: 5, content: "Later B" },
      }],
    });

    initializeOfflineSyncStore(memento);
    const existing = getOfflineSyncQueue().tickets.get(7);
    const created = getOfflineSyncQueue().newTickets[0];

    assert.strictEqual(existing?.phase, "commit_unknown");
    assert.strictEqual(existing?.revision, 4);
    assert.strictEqual(existing?.description, "Active A");
    assert.strictEqual(existing?.nextIntent?.revision, 5);
    assert.strictEqual(existing?.nextIntent?.description, "Later B");
    assert.strictEqual(created.phase, "commit_unknown");
    assert.strictEqual(created.revision, 4);
    assert.strictEqual(created.content, "Active A");
    assert.strictEqual(created.nextIntent?.revision, 5);
    assert.strictEqual(created.nextIntent?.content, "Later B");
  });

  test("legacy migration も scope persistence lane を使い、新しい mutation より先に完了する", async () => {
    let releaseFirst: (() => void) | undefined;
    const writes: Array<{ key: string; value: unknown }> = [];
    let calls = 0;
    const memento = {
      get: <T>(key: string, defaultValue?: T): T => {
        if (key === "redmine.offlineSyncQueue") {
          return { tickets: [[1, ticketUpdate(1)]], comments: [], newTickets: [] } as T;
        }
        return defaultValue as T;
      },
      keys: (): readonly string[] => [],
      update: async (key: string, value: unknown): Promise<void> => {
        calls++;
        writes.push({ key, value });
        if (calls === 1) {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
      },
    };
    const scope = "migration-lane";
    initializeOfflineSyncStore(memento as import("vscode").Memento, scope);
    const pendingMutation = addOfflineTicketUpdateAsync(2, ticketUpdate(2), scope);
    await Promise.resolve();

    assert.strictEqual(writes.length, 1);
    releaseFirst?.();
    await pendingMutation;

    assert.deepStrictEqual(writes.map((write) => write.key), [
      "redmine.offlineSyncQueue.migration-lane",
      "redmine.offlineSyncQueue",
      "redmine.offlineSyncQueue.migration-lane",
    ]);
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

  test("untitled/file URI variants は同一 document operation として扱う", async () => {
    const stale = "untitled:/tmp/same-ticket.md";
    const saved = "file:///tmp/same-ticket.md";
    await addOfflineNewTicketAsync({
      content: "# First",
      documentUri: stale,
      createdIssueId: 321,
      phase: "local_finalize_pending",
    });
    const operationId = getOfflineSyncQueue().newTickets[0].operationId;

    await addOfflineNewTicketAsync({ content: "# Saved", documentUri: saved });
    const queue = getOfflineSyncQueue();
    assert.strictEqual(queue.newTickets.length, 1);
    assert.strictEqual(queue.newTickets[0].operationId, operationId);
    assert.strictEqual(queue.newTickets[0].createdIssueId, 321);
  });

  test("remote committed ticket update に後続 save が来ても pending phase を queued へ戻さない", async () => {
    await addOfflineTicketUpdateAsync(901, {
      ...ticketUpdate(901),
      phase: "reconciliation_pending",
      operationId: "ticket-901",
    });
    await addOfflineTicketUpdateAsync(901, {
      ...ticketUpdate(901),
      description: "Saved while pending",
      phase: "queued",
    });

    const restored = getOfflineSyncQueue().tickets.get(901);
    assert.strictEqual(restored?.phase, "reconciliation_pending");
    assert.strictEqual(restored?.operationId, "ticket-901");
  });

  test("remote committed ticket update の active payload を後続 save が上書きしない", async () => {
    await addOfflineTicketUpdateAsync(902, {
      ...ticketUpdate(902),
      description: "Already sent",
      phase: "reconciliation_pending",
      operationId: "ticket-902",
    });

    await addOfflineTicketUpdateAsync(902, {
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

  test("preparing 中の後続 save は active revision を変更せず nextIntent に保持する", async () => {
    await addOfflineTicketUpdateAsync(9021, {
      ...ticketUpdate(9021),
      description: "Revision A",
      phase: "preparing",
      revision: 4,
    });

    await addOfflineTicketUpdateAsync(9021, {
      ...ticketUpdate(9021),
      description: "Revision B",
      phase: "queued",
    });

    const operation = getOfflineSyncQueue().tickets.get(9021);
    assert.strictEqual(operation?.phase, "preparing");
    assert.strictEqual(operation?.description, "Revision A");
    assert.strictEqual(operation?.nextIntent?.description, "Revision B");
    assert.strictEqual(operation?.nextIntent?.revision, 5);
  });

  test("pre-remote abort は後続 intent を queued active へ昇格する", async () => {
    await addOfflineTicketUpdateAsync(9023, {
      ...ticketUpdate(9023),
      description: "Revision A",
      phase: "preparing",
      revision: 4,
    });
    await addOfflineTicketUpdateAsync(9023, {
      ...ticketUpdate(9023),
      description: "Revision B",
      phase: "queued",
    });
    await addOfflineNewTicketAsync({
      content: "A",
      documentUri: "file:///tmp/abort-new.md",
      phase: "preparing",
      revision: 4,
    });
    await addOfflineNewTicketAsync({
      content: "B",
      documentUri: "file:///tmp/abort-new.md",
      phase: "queued",
    });

    const existing = await abortOfflineTicketUpdateBeforeRemoteWriteAsync(9023, "", 4);
    const created = await abortOfflineNewTicketBeforeRemoteWriteAsync(
      { documentUri: "file:///tmp/abort-new.md" }, "", 4,
    );

    assert.strictEqual(existing?.description, "Revision B");
    assert.strictEqual(existing?.phase, "queued");
    assert.strictEqual(existing?.nextIntent, undefined);
    assert.strictEqual(existing?.revision, 5);
    assert.strictEqual(created?.content, "B");
    assert.strictEqual(created?.phase, "queued");
    assert.strictEqual(created?.nextIntent, undefined);
    assert.strictEqual(created?.revision, 5);
  });

  test("stale revision の durable mutation と completion は拒否する", async () => {
    await addOfflineTicketUpdateAsync(9022, {
      ...ticketUpdate(9022),
      phase: "preparing",
      revision: 4,
    });

    const marked = await updateOfflineTicketUpdateAsync(
      9022,
      { phase: "remote_write_started" },
      "",
      3,
    );
    const completed = await completeOfflineTicketUpdateAsync(9022, "", undefined, 3);

    assert.strictEqual(marked, undefined);
    assert.strictEqual(completed, false);
    assert.strictEqual(getOfflineSyncQueue().tickets.get(9022)?.phase, "preparing");
  });

  test("parent remote write の phase transition と effect checkpoint を同時に永続化する", async () => {
    await addOfflineNewTicketAsync({
      content: "# Effect checkpoint",
      documentUri: "file:///tmp/effect-checkpoint.md",
    });
    let operation = getOfflineSyncQueue().newTickets[0];
    operation = (await transitionOfflineNewTicketLifecycleAsync(
      { queueId: operation.queueId },
      { kind: "begin_preparation" },
      "",
      {
        operationId: operation.operationId!,
        revision: operation.revision!,
        sourcePhase: "queued",
      },
    ))!;
    assert.strictEqual(operation.effects?.[0].state, "planned");

    operation = (await transitionOfflineNewTicketLifecycleAsync(
      { queueId: operation.queueId },
      { kind: "start_normal_remote_write" },
      "",
      {
        operationId: operation.operationId!,
        revision: operation.revision!,
        sourcePhase: "preparing",
      },
    ))!;
    assert.strictEqual(operation.phase, "remote_write_started");
    assert.strictEqual(operation.effects?.[0].state, "started");

    operation = (await transitionOfflineNewTicketLifecycleAsync(
      { queueId: operation.queueId },
      { kind: "record_remote_created", ticketId: 700 },
      "",
      {
        operationId: operation.operationId!,
        revision: operation.revision!,
        sourcePhase: "remote_write_started",
      },
    ))!;
    assert.strictEqual(operation.effects?.[0].state, "committed");
    assert.strictEqual(operation.effects?.[0].remoteId, 700);
  });

  test("generic phase=queued mutation は nextIntent を昇格せず invariant 違反を拒否する", async () => {
    await addOfflineTicketUpdateAsync(9024, {
      ...ticketUpdate(9024),
      description: "Active A",
      phase: "commit_unknown",
      revision: 4,
    });
    await addOfflineTicketUpdateAsync(9024, {
      ...ticketUpdate(9024),
      description: "Later B",
    });
    const before = getOfflineSyncQueue().tickets.get(9024)!;

    const updated = await updateOfflineTicketUpdateAsync(
      9024,
      { phase: "queued" },
      "",
      before.revision,
    );

    const after = getOfflineSyncQueue().tickets.get(9024);
    assert.strictEqual(updated, undefined);
    assert.strictEqual(after?.phase, "commit_unknown");
    assert.strictEqual(after?.description, "Active A");
    assert.strictEqual(after?.nextIntent?.description, "Later B");
  });

  test("new-ticket Retry と Link の同一source CASは一方だけ成功する", async () => {
    await addOfflineNewTicketAsync({
      content: "Active A",
      documentUri: "file:///tmp/recovery-race.md",
      phase: "commit_unknown",
      revision: 4,
    });
    await addOfflineNewTicketAsync({
      content: "Later B",
      documentUri: "file:///tmp/recovery-race.md",
    });
    const operation = getOfflineSyncQueue().newTickets[0];
    const expected = {
      operationId: operation.operationId!,
      revision: operation.revision!,
      sourcePhase: "commit_unknown" as const,
    };

    const results = await Promise.all([
      transitionOfflineNewTicketLifecycleAsync(
        { queueId: operation.queueId },
        { kind: "start_explicit_retry_remote_write" },
        "",
        expected,
      ),
      transitionOfflineNewTicketLifecycleAsync(
        { queueId: operation.queueId },
        { kind: "link_created_ticket", ticketId: 99 },
        "",
        expected,
      ),
    ]);

    assert.strictEqual(results.filter(Boolean).length, 1);
    const current = getOfflineSyncQueue().newTickets[0];
    assert.ok(current.phase === "remote_write_started" || current.phase === "remote_created");
    assert.strictEqual(current.content, "Active A");
    assert.strictEqual(current.nextIntent?.content, "Later B");
  });

  test("existing-ticket Retry と Assume の同一source CASは一方だけ成功する", async () => {
    await addOfflineTicketUpdateAsync(9025, {
      ...ticketUpdate(9025),
      description: "Active A",
      phase: "commit_unknown",
      revision: 4,
    });
    const operation = getOfflineSyncQueue().tickets.get(9025)!;
    const expected = {
      operationId: operation.operationId!,
      revision: operation.revision!,
      sourcePhase: "commit_unknown" as const,
    };

    const results = await Promise.all([
      transitionOfflineTicketUpdateLifecycleAsync(
        9025,
        { kind: "start_explicit_retry_remote_write" },
        "",
        expected,
      ),
      transitionOfflineTicketUpdateLifecycleAsync(
        9025,
        { kind: "assume_update_committed" },
        "",
        expected,
      ),
    ]);

    assert.strictEqual(results.filter(Boolean).length, 1);
    const phase = getOfflineSyncQueue().tickets.get(9025)?.phase;
    assert.ok(phase === "remote_write_started" || phase === "remote_committed");
  });

  test("semantic transition は operation identity・scope・source phase の不一致を拒否する", async () => {
    const scope = "scope-b";
    await addOfflineTicketUpdateAsync(9026, {
      ...ticketUpdate(9026),
      operationId: "operation-9026",
      connectionScope: "scope-a",
      phase: "preparing",
      revision: 4,
    }, scope);

    const wrongIdentity = await transitionOfflineTicketUpdateLifecycleAsync(
      9026,
      { kind: "start_normal_remote_write" },
      scope,
      { operationId: "stale-operation", revision: 4, sourcePhase: "preparing" },
    );
    const wrongScope = await transitionOfflineTicketUpdateLifecycleAsync(
      9026,
      { kind: "start_normal_remote_write" },
      scope,
      { operationId: "operation-9026", revision: 4, sourcePhase: "preparing" },
    );
    const wrongSource = await transitionOfflineTicketUpdateLifecycleAsync(
      9026,
      { kind: "start_normal_remote_write" },
      scope,
      { operationId: "operation-9026", revision: 4, sourcePhase: "queued" },
    );

    assert.strictEqual(wrongIdentity, undefined);
    assert.strictEqual(wrongScope, undefined);
    assert.strictEqual(wrongSource, undefined);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(9026)?.phase, "preparing");
  });

  test("async new-ticket mutation は await 中の並べ替え後も元の operation を返す", async () => {
    let release: (() => void) | undefined;
    let writes = 0;
    const memento = {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      keys: (): readonly string[] => [],
      update: async (): Promise<void> => {
        writes++;
        if (writes === 3) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
      },
    };
    initializeOfflineSyncStore(memento as import("vscode").Memento, "stable-handle");
    await addOfflineNewTicketAsync({ content: "X", documentUri: "file:///tmp/x.md" }, "stable-handle");
    await addOfflineNewTicketAsync({ content: "B", documentUri: "file:///tmp/b.md" }, "stable-handle");
    const b = getOfflineSyncQueue("stable-handle").newTickets.find((item) => item.content === "B")!;
    const pending = updateOfflineNewTicketAsync(
      { queueId: b.queueId },
      { createdIssueId: 77 },
      "stable-handle",
      b.revision,
    );
    await Promise.resolve();
    const laterSave = addOfflineNewTicketAsync(
      { content: "X2", documentUri: "file:///tmp/x.md" },
      "stable-handle",
    );
    release?.();
    const updated = await pending;
    await laterSave;

    assert.strictEqual(updated?.operationId, b.operationId);
    assert.strictEqual(updated?.createdIssueId, 77);
    assert.strictEqual(getOfflineSyncQueue("stable-handle").newTickets.find(
      (item) => item.documentUri === "file:///tmp/x.md",
    )?.createdIssueId, undefined);
  });

  test("remote created new ticket の active content を後続 save が上書きしない", async () => {
    await addOfflineNewTicketAsync({
      content: "# Already sent",
      documentUri: "file:///tmp/pending-new.md",
      createdIssueId: 903,
      phase: "local_finalize_pending",
    });
    const active = getOfflineSyncQueue().newTickets[0];

    await addOfflineNewTicketAsync({
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

    const first = addOfflineTicketUpdateAsync(1, ticketUpdate(1), "scope-serial");
    const second = addOfflineTicketUpdateAsync(2, ticketUpdate(2), "scope-serial");
    await Promise.resolve();

    assert.strictEqual(updateCalls, 1);
    releases.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(updateCalls, 2);
    releases.shift()?.();
    await Promise.all([first, second]);
  });

  test("I-13 remote-created new ticket の durable checkpoint は通常 discard で削除しない", async () => {
    await addOfflineNewTicketAsync({
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

  test("remote checkpoint を持つticketも確認済みの破棄でキューから削除する", async () => {
    await addOfflineTicketUpdateAsync(911, {
      ...ticketUpdate(911),
      phase: "reconciliation_pending",
    });
    await addOfflineTicketUpdateAsync(911, {
      ...ticketUpdate(911),
      description: "Later edit",
    });

    const result = await discardOfflineTicketUpdateAsync(911, "");

    assert.strictEqual(result, "discarded");
    assert.strictEqual(getOfflineSyncQueue().tickets.has(911), false);
  });

  test("I-15 10,000回の後続saveをidentityあたりactive+nextの2 snapshotへcoalesceする", async () => {
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

  test("I-15 comment も10,000回の後続saveをactive+nextの2 snapshotへcoalesceする", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 913,
      commentId: 19,
      body: "Active body",
      phase: "reconciliation_pending",
    });

    for (let revision = 1; revision <= 10_000; revision++) {
      await addOfflineCommentUpdateAsync({
        ticketId: 913,
        commentId: 19,
        body: `Later body ${revision}`,
      });
    }

    const operation = getOfflineSyncQueue().comments[0];
    assert.strictEqual(operation.phase, "reconciliation_pending");
    assert.strictEqual(operation.body, "Active body");
    assert.strictEqual(operation.nextIntent?.body, "Later body 10000");
    assert.strictEqual(operation.nextIntent?.revision, 10_001);
    assert.strictEqual(getOfflineSyncQueue().comments.length, 1);
  });
});
