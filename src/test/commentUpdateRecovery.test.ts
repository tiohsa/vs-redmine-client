import * as assert from "assert";
import { initializeOfflineSyncStore, addOfflineCommentUpdate, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://comments.example.org/";

suite("RT-01: Comment Update Recovery Correctness (commentUpdateRecovery.test.ts)", () => {
  test("RT-01: remote update timeout 後、remote body が古い（未コミット）場合は reconcile しても completed にならず queue を保持し、自動再送しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-update-recovery-fail.md";
    addOfflineCommentUpdate({
      ticketId: 100,
      commentId: 200,
      baseBody: "Old remote body",
      body: "Intended new body",
      documentUri,
    }, SCOPE);

    let updateCalls = 0;
    let getIssueDetailCalls = 0;

    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("should not add comment"); },
        updateComment: async () => {
          updateCalls++;
          throw new Error("Network timeout while updating comment");
        },
        getIssueDetail: async () => {
          getIssueDetailCalls++;
          return {
            ticket: { id: 100, subject: "Test Ticket", projectId: 1, updatedAt: "2026-08-14T00:00:00Z" },
            comments: [{
              id: 200,
              body: "Old remote body", // remote はまだ古いまま
              authorId: 5,
              ticketId: 100,
              authorName: "Test User",
              editableByCurrentUser: true,
              updatedAt: "2026-08-14T00:00:00Z",
            }],
          };
        },
        getCurrentUserId: async () => 5,
      },
    });

    const key = { kind: "comment" as const, ticketId: 100, commentId: 200, documentUri };

    // 1. 初回 syncOne -> タイムアウトで commit_unknown
    const firstOutcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(firstOutcome.kind, "commit_unknown", "タイムアウト時は commit_unknown になること");
    assert.strictEqual(updateCalls, 1, "updateComment が1回呼ばれたこと");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 1, "キューが保持されていること");

    // 2. 2回目の通常 syncOne -> 自動再送せず commit_unknown を返す (INV-04)
    const retryOutcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(retryOutcome.kind, "commit_unknown", "commit_unknown から通常 sync で自動再送しないこと");
    assert.strictEqual(updateCalls, 1, "updateComment が再実行されないこと");

    // 3. 明示的 reconciliation -> remote body が古いので completed にならない (INV-24)
    const reconcileOutcome = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_remote" },
    });

    assert.notStrictEqual(reconcileOutcome.kind, "completed", "remote body が一致しない場合は completed にならないこと");
    assert.strictEqual(reconcileOutcome.kind, "commit_unknown", "reconciliation 失敗時は commit_unknown のまま");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 1, "キューが保持されていること");
  });

  test("RT-01: remote update timeout 後、remote body が更新後の値と一致する場合のみ recovery 成功 (completed) となる", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    addOfflineCommentUpdate({
      ticketId: 101,
      commentId: 201,
      baseBody: "Old remote body",
      body: "Intended new body",
    }, SCOPE);

    let updateCalls = 0;

    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("should not add comment"); },
        updateComment: async () => {
          updateCalls++;
          throw new Error("Network timeout while updating comment");
        },
        getIssueDetail: async () => ({
          ticket: { id: 101, subject: "Test Ticket", projectId: 1, updatedAt: "2026-08-14T01:00:00Z" },
          comments: [{
            id: 201,
            body: "Intended new body", // remote にコミットされていた
            authorId: 5,
            ticketId: 101,
            authorName: "Test User",
            editableByCurrentUser: true,
            updatedAt: "2026-08-14T01:00:00Z",
          }],
        }),
        getCurrentUserId: async () => 5,
      },
    });

    const key = { kind: "comment" as const, ticketId: 101, commentId: 201 };

    // 1. 初回 syncOne -> タイムアウトで commit_unknown
    const firstOutcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(firstOutcome.kind, "commit_unknown");

    // 2. 明示的 reconciliation -> remote body が一致するので completed になる
    const reconcileOutcome = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_remote" },
    });

    assert.strictEqual(reconcileOutcome.kind, "completed", "remote body が一致する場合は recovery 成功すること");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0, "キューが完了・削除されること");
  });
});
