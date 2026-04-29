import * as assert from "assert";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
  addOfflineCommentUpdate,
  addOfflineNewTicket,
  getOfflineSyncQueue,
  replaceOfflineSyncQueue,
  clearOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { applyQueuedTicketUpdate } from "../views/ticketSaveSync";
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
  setup(() => {
    initializeOfflineSyncStore(createTestMemento());
  });

  teardown(() => {
    clearOfflineSyncQueue();
  });

  // ── applyQueuedTicketUpdate ────────────────────────────────────────────────

  test("applyQueuedTicketUpdate: 成功時に success を返す", async () => {
    let updated = false;
    const result = await applyQueuedTicketUpdate({
      update: makeTicketUpdate(1),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 1, subject: "Updated", projectId: 1, updatedAt: "t2" },
          comments: [],
        }),
        updateIssue: async () => {
          updated = true;
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    assert.strictEqual(result.status, "success");
    assert.ok(updated);
  });

  test("applyQueuedTicketUpdate: updateIssue が 503 エラーのとき unreachable を返す", async () => {
    const result = await applyQueuedTicketUpdate({
      update: makeTicketUpdate(2),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 2, subject: "Updated", projectId: 1, updatedAt: "t2" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    assert.strictEqual(result.status, "unreachable");
  });

  test("applyQueuedTicketUpdate: conflict 時に conflict を返す", async () => {
    const result = await applyQueuedTicketUpdate({
      update: { ...makeTicketUpdate(3), lastKnownRemoteUpdatedAt: "t1" },
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 3, subject: "Updated remotely", projectId: 1, updatedAt: "t2" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("should not reach here");
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    assert.strictEqual(result.status, "conflict");
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

  test("成功分は replaceOfflineSyncQueue で除去される", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(1, makeTicketUpdate(1));
    addOfflineTicketUpdate(2, makeTicketUpdate(2));
    addOfflineCommentUpdate({ ticketId: 10, commentId: 99, body: "comment" });

    // チケット1は成功（除去）、チケット2は失敗（残す）
    const failedTickets = [makeTicketUpdate(2)];
    const failedComments = [{ ticketId: 10, commentId: 99, body: "comment" }];
    replaceOfflineSyncQueue({
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

  test("全件成功時は clearOfflineSyncQueue でキューが空になる", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(1, makeTicketUpdate(1));
    addOfflineCommentUpdate({ ticketId: 10, commentId: 99, body: "comment" });
    addOfflineNewTicket({ content: "# New Ticket\n\nBody" });

    clearOfflineSyncQueue();

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 0);
    assert.strictEqual(q.comments.length, 0);
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("同じ ticketId を二度 queue に追加しても重複しない", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    addOfflineTicketUpdate(5, makeTicketUpdate(5));
    addOfflineTicketUpdate(5, { ...makeTicketUpdate(5), subject: "Updated again" });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.tickets.size, 1);
    assert.strictEqual(q.tickets.get(5)?.subject, "Updated again");
  });

  test("同じ documentUri のコメントを二度 queue に追加しても重複しない", () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento);

    const docUri = "file:///tmp/comment_draft.md";
    addOfflineCommentUpdate({ ticketId: 10, body: "first", documentUri: docUri });
    addOfflineCommentUpdate({ ticketId: 10, body: "second", documentUri: docUri });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.comments.length, 1);
    assert.strictEqual(q.comments[0].body, "second");
  });
});
