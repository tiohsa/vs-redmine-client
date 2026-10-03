import * as assert from "assert";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdateAsync,
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  getOfflineSyncQueue,
  replaceOfflineSyncQueueAsync,
  clearOfflineSyncQueueAsync,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createSyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { applyQueuedCommentUpdate } from "../views/commentSaveSync";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const makeTicketUpdate = (ticketId: number) => ({
  ticketId,
  baseSubject: "Base",
  baseDescription: "Base body",
  baseMetadata: buildIssueMetadataFixture(),
  subject: "Updated",
  description: "Updated body",
  metadata: buildIssueMetadataFixture(),
});

suite("Offline Sync partial failure", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento());
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync();
  });

  test("SyncEngine: 成功時にprimary effectを完了しqueueから除去する", async () => {
    await addOfflineTicketUpdateAsync(1, makeTicketUpdate(1));
    let updateCalls = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => ({ ticket: {
        id: 1, subject: "Updated", description: "Updated body", projectId: 1, updatedAt: "t2",
      }, comments: [] }),
      updateIssue: async () => { updateCalls++; },
    } });
    const result = await engine.syncOne({ kind: "ticket", ticketId: 1 }, { connectionScope: "" });
    assert.strictEqual(result.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getOfflineSyncQueue().tickets.has(1), false);
    const operation = engine.getRepository().getOperation({ kind: "ticket", ticketId: 1 }, "");
    assert.strictEqual(operation?.phase, "completed");
    assert.strictEqual(operation?.effects?.find((effect) => effect.kind === "ticket_update")?.state, "committed");
  });

  for (const failure of [
    { message: "Redmine request failed (503): Service Unavailable", outcome: "failed_before_commit", state: "failed" },
    { message: "network timeout", outcome: "commit_unknown", state: "commit_unknown" },
  ] as const) {
  test(`SyncEngine: ${failure.state} を保持し自動再送しない`, async () => {
    await addOfflineTicketUpdateAsync(2, makeTicketUpdate(2));
    let updateCalls = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => ({ ticket: { id: 2, subject: "Base", projectId: 1, updatedAt: "t1" }, comments: [] }),
      updateIssue: async () => {
        updateCalls++;
        throw new Error(failure.message);
      },
    } });
    const key = { kind: "ticket" as const, ticketId: 2 };
    const result = await engine.syncOne(key, { connectionScope: "" });
    assert.strictEqual(result.kind, failure.outcome);
    const queued = getOfflineSyncQueue().tickets.get(2);
    assert.ok(queued);
    if (failure.state === "commit_unknown") { assert.strictEqual(queued.phase, "commit_unknown"); }
    assert.strictEqual(queued.effects?.find((effect) => effect.kind === "ticket_update")?.state, failure.state);
    await engine.syncOne(key, { connectionScope: "" });
    assert.strictEqual(updateCalls, 1);
  });
  }

  test("SyncEngine: conflict時はremote writeせずqueueを保持する", async () => {
    await addOfflineTicketUpdateAsync(3, { ...makeTicketUpdate(3), lastKnownRemoteUpdatedAt: "t1" });
    let updateCalls = 0;
    const engine = createSyncEngine({ tickets: {
      getIssueDetail: async () => ({ ticket: {
        id: 3, subject: "Updated remotely", projectId: 1, updatedAt: "t2",
      }, comments: [] }),
      updateIssue: async () => { updateCalls++; },
    } });
    const result = await engine.syncOne({ kind: "ticket", ticketId: 3 }, { connectionScope: "" });
    assert.strictEqual(result.kind, "conflict");
    assert.strictEqual(updateCalls, 0);
    assert.strictEqual(getOfflineSyncQueue().tickets.get(3)?.phase, "queued");
  });

  test("primary started checkpoint失敗では親も子もremote writeしない", async () => {
    class RejectPrimaryStartRepository extends DefaultSyncOperationRepository {
      public override async transitionPrimaryRemoteWrite(
        ...args: Parameters<DefaultSyncOperationRepository["transitionPrimaryRemoteWrite"]>
      ): ReturnType<DefaultSyncOperationRepository["transitionPrimaryRemoteWrite"]> {
        if (args[1].kind === "start") { throw new Error("journal unavailable"); }
        return super.transitionPrimaryRemoteWrite(...args);
      }
    }
    await addOfflineTicketUpdateAsync(14, {
      ...makeTicketUpdate(14), metadata: { ...buildIssueMetadataFixture(), children: ["Child"] },
    });
    let updateCalls = 0;
    let createCalls = 0;
    let deleteCalls = 0;
    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: new RejectPrimaryStartRepository() }),
      tickets: {
        createIssue: async () => { createCalls++; return 1401; },
        deleteIssue: async () => { deleteCalls++; },
        updateIssue: async () => { updateCalls++; },
        getIssueDetail: async () => ({ ticket: {
          id: 14, subject: "Base", description: "Base body", projectId: 1,
        }, comments: [] }),
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
      },
    });
    await assert.rejects(
      engine.syncOne({ kind: "ticket", ticketId: 14 }, { connectionScope: "" }),
      /journal unavailable/,
    );
    assert.strictEqual(updateCalls, 0);
    assert.strictEqual(createCalls, 0);
    assert.strictEqual(deleteCalls, 0);
    const queued = getOfflineSyncQueue().tickets.get(14);
    assert.strictEqual(queued?.phase, "preparing");
    assert.strictEqual(queued?.effects?.find((effect) => effect.kind === "ticket_update")?.state, "planned");
  });

  // ── applyQueuedCommentUpdate ──────────────────────────────────────────────

  test("applyQueuedCommentUpdate: 既存コメント更新が成功する", async () => {
    let updated = false;
    const result = await applyQueuedCommentUpdate({
      update: { ticketId: 10, commentId: 99, baseBody: "old", body: "new body" },
      deps: {
        updateComment: async () => {
          updated = true;
        },
        addComment: async () => {
          throw new Error("should not add");
        },
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          comments: [],
        }),
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    assert.strictEqual(result.status, "success");
    assert.ok(updated);
  });

  test("applyQueuedCommentUpdate: API エラーで失敗する", async () => {
    const result = await applyQueuedCommentUpdate({
      update: { ticketId: 10, commentId: 99, baseBody: "old", body: "new body" },
      deps: {
        updateComment: async () => {
          throw new Error("Redmine request failed (500): Internal Server Error");
        },
        addComment: async () => {
          throw new Error("should not add");
        },
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          comments: [],
        }),
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    assert.strictEqual(result.status, "unreachable");
  });

  // ── キュー状態管理 ────────────────────────────────────────────────────────

  test("成功分は replaceOfflineSyncQueueAsync で除去される", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(1, makeTicketUpdate(1));
    await addOfflineTicketUpdateAsync(2, makeTicketUpdate(2));
    await addOfflineCommentUpdateAsync({ ticketId: 10, commentId: 99, body: "comment" });

    // チケット1は成功（除去）、チケット2は失敗（残す）
    const failedTickets = [makeTicketUpdate(2)];
    const failedComments = [{ ticketId: 10, commentId: 99, body: "comment" }];
    await replaceOfflineSyncQueueAsync({
      tickets: new Map(failedTickets.map((t) => [t.ticketId, t])),
      comments: failedComments,
      newTickets: [],
    });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.ok(q.tickets.has(2));
    assert.ok(!q.tickets.has(1));
    assert.strictEqual(q.comments.length, 1);
  });

  test("全件成功時は clearOfflineSyncQueueAsync でキューが空になる", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(1, makeTicketUpdate(1));
    await addOfflineCommentUpdateAsync({ ticketId: 10, commentId: 99, body: "comment" });
    await addOfflineNewTicketAsync({ content: "# New Ticket\n\nBody" });

    await clearOfflineSyncQueueAsync();

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("同じ ticketId を二度 queue に追加しても重複しない", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    await addOfflineTicketUpdateAsync(5, makeTicketUpdate(5));
    await addOfflineTicketUpdateAsync(5, { ...makeTicketUpdate(5), subject: "Updated again" });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.strictEqual(q.tickets.get(5)?.subject, "Updated again");
  });

  test("同じ documentUri のコメントを二度 queue に追加しても重複しない", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    const docUri = "file:///tmp/comment_draft.md";
    await addOfflineCommentUpdateAsync({ ticketId: 10, body: "first", documentUri: docUri });
    await addOfflineCommentUpdateAsync({ ticketId: 10, body: "second", documentUri: docUri });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.comments.length, 1);
    assert.strictEqual(q.comments[0].body, "second");
  });
});
