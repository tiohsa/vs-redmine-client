import * as assert from "assert";
import { createSyncEngine } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { computeNotesHash } from "../utils/notesHash";
import {
  clearCommentEdits,
  getCommentEdit,
  initializeCommentEdit,
} from "../views/commentEditStore";
import {
  addOfflineCommentUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

const scope = getCurrentConnectionScope();

suite("comment sync finalize regression", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    await clearOfflineSyncQueueAsync(scope);
    clearCommentEdits();
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync(scope);
    clearCommentEdits();
  });

  test("通常 comment editor は read-back の comment timestamp で完了し、次の同期も進む", async () => {
    const ticketId = 901;
    const commentId = 902;
    const documentUri = `file:///tmp/project-1_ticket-${ticketId}_comment-${commentId}.md`;
    let remoteBody = "Base body";
    let remoteUpdatedAt = "t1";
    let updateCalls = 0;

    initializeCommentEdit(commentId, ticketId, remoteBody, remoteUpdatedAt, scope);

    const engine = createSyncEngine({
      comments: {
        getIssueDetail: async () => ({
          ticket: {
            id: ticketId,
            projectId: 1,
            subject: "Ticket",
            updatedAt: "ticket-timestamp",
          },
          comments: [{
            id: commentId,
            ticketId,
            authorId: 1,
            authorName: "Tester",
            body: remoteBody,
            updatedAt: remoteUpdatedAt,
            editableByCurrentUser: true,
          }],
        }),
        updateComment: async (_commentId, body) => {
          updateCalls += 1;
          remoteBody = body;
          remoteUpdatedAt = `t${updateCalls + 1}`;
        },
      },
    });

    const syncBody = async (body: string): Promise<void> => {
      const edit = getCommentEdit(commentId, scope);
      assert.ok(edit);
      await addOfflineCommentUpdateAsync({
        ticketId,
        commentId,
        baseBody: edit!.baseBody,
        body,
        lastKnownRemoteUpdatedAt: edit!.lastKnownRemoteUpdatedAt,
        documentUri,
      }, scope);

      const outcome = await engine.syncOne(
        { kind: "comment", ticketId, commentId, documentUri },
        { connectionScope: scope },
      );
      assert.strictEqual(outcome.kind, "completed");
      assert.strictEqual(
        getOfflineSyncQueue(scope).comments.some((entry) => entry.commentId === commentId),
        false,
      );
      assert.strictEqual(getCommentEdit(commentId, scope)?.baseBody, body);
      assert.strictEqual(getCommentEdit(commentId, scope)?.lastKnownRemoteUpdatedAt, remoteUpdatedAt);
    };

    await syncBody("First local body");
    await syncBody("Second local body");
    assert.strictEqual(updateCalls, 2);
  });

  test("base body を持たない comment-update file の conflict は三者 merge 不可を示す", async () => {
    const ticketId = 903;
    const commentId = 904;
    const baseBody = "Original remote body";
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      body: "Local body",
      sourceNotesHash: computeNotesHash(baseBody),
      documentUri: `file:///tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`,
    }, scope);

    const engine = createSyncEngine({
      comments: {
        getIssueDetail: async () => ({
          ticket: { id: ticketId, projectId: 1, subject: "Ticket", updatedAt: "ticket-t2" },
          comments: [{
            id: commentId,
            ticketId,
            authorId: 1,
            authorName: "Tester",
            body: "Changed remote body",
            updatedAt: "comment-t2",
            editableByCurrentUser: true,
          }],
        }),
      },
    });

    const outcome = await engine.syncOne(
      {
        kind: "comment",
        ticketId,
        commentId,
        documentUri: `file:///tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`,
      },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "conflict");
    if (outcome.kind !== "conflict" || !("commentConflictContext" in outcome)) {
      assert.fail("comment conflict context が必要です");
    }
    assert.strictEqual(outcome.commentConflictContext?.baseBodyKnown, false);
  });
});
