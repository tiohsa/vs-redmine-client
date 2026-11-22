import * as assert from "node:assert/strict";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { beginSyncUnlessDeleting } from "../app/ticketSync/syncDeletionGuard";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import type { UnifiedSyncOperation } from "../app/ticketSync/syncOperationTypes";
import { assertCanDelete, runProtectedDelete } from "../dashboard/services/dashboardDeletionProtection";
import { computeNotesHash } from "../utils/notesHash";
import { clearCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { clearCommentEdit, initializeCommentEdit, setCommentDraftBody } from "../views/commentEditStore";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { addOfflineCommentUpdateAsync, clearOfflineSyncQueueAsync } from "../views/offlineSyncStore";

const scope = "https://dashboard-deletion-protection.invalid/";
const root = 42;
const child = 43;
const comment = 107;

function commentOperation(connectionScope: string, commentId = comment): UnifiedSyncOperation {
  return {
    kind: "comment_update",
    connectionScope,
    operationId: `comment:${commentId}`,
    persistenceVersion: 1,
    revision: 1,
    phase: "queued",
    ticketId: child,
    commentId,
  };
}

suite("Dashboard 削除の未同期保護", () => {
  test("配下の下書きと保留中の同期を保護し、同じ数値 ID の別接続先を分離する", async () => {
    const target = { connectionScope: scope, ticketIds: [root, child] };
    const commentTarget = { connectionScope: scope, ticketIds: [child], commentIds: [comment] };
    initializeCommentEdit(comment, child, "saved", undefined, scope);
    setCommentDraftBody(comment, "draft", scope);
    try {
      assert.throws(() => assertCanDelete(target), /Resolve unsaved changes/);
      assert.throws(() => assertCanDelete(commentTarget), /Resolve unsaved changes/);
      assert.doesNotThrow(() => assertCanDelete({ ...commentTarget, commentIds: [comment + 1] }));
      assert.doesNotThrow(() => assertCanDelete({ ...target, connectionScope: `${scope}other/` }));
    } finally {
      clearCommentEdit(comment, scope);
    }
    setCommentDraft(child, buildCommentUpdateFileContent({
      issueId: child, journalId: comment, sourceNotesHash: computeNotesHash("saved"),
    }, "cached edit"), scope);
    try {
      assert.throws(() => assertCanDelete(commentTarget), /Resolve unsaved changes/);
      assert.doesNotThrow(() => assertCanDelete({ ...commentTarget, commentIds: [comment + 1] }));
    } finally {
      clearCommentDraft(child, scope);
    }
    await addOfflineCommentUpdateAsync({ ticketId: child, commentId: comment, body: "queued" }, scope);
    try {
      assert.throws(() => assertCanDelete(target), /pending sync/);
      const queue = createSyncOperationRepository().listOperations(scope);
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0]?.commentId, comment);
      assert.strictEqual(queue[0]?.phase, "queued");
    } finally {
      await clearOfflineSyncQueueAsync(scope);
    }
  });

  test("書き込みと読み戻しの間に同じ対象の同期を開始せず、待機中の編集を保持する", async () => {
    const possibleChild = 44;
    const target = { connectionScope: scope, ticketIds: [root, child], possibleTicketIds: [possibleChild] };
    const otherScope = `${scope}other/`;
    let finishReadBack!: () => void;
    const readBack = new Promise<void>(resolve => { finishReadBack = resolve; });
    const deletion = runProtectedDelete(target, () => readBack);
    const repository = createSyncOperationRepository();
    const coordinator = new SyncCoordinator({ repository });
    try {
      const disjoint = beginSyncUnlessDeleting(otherScope, commentOperation(otherScope));
      assert.ok(disjoint);
      disjoint();
      assert.strictEqual(beginSyncUnlessDeleting(scope, commentOperation(scope)), undefined);
      assert.strictEqual(beginSyncUnlessDeleting(scope, { ...commentOperation(scope), ticketId: possibleChild }), undefined);
      await assert.rejects(runProtectedDelete(target, async () => undefined), /Deletion is in progress/);
      await addOfflineCommentUpdateAsync({ ticketId: child, commentId: comment, body: "during deletion" }, scope);
      const result = await coordinator.sync({ kind: "comment", ticketId: child, commentId: comment }, { connectionScope: scope });
      assert.strictEqual(result.kind, "failed_before_commit");
      assert.match(result.error.message, /Deletion is in progress/);
      assert.strictEqual(repository.listOperations(scope)[0]?.phase, "queued");
    } finally {
      finishReadBack();
      await deletion;
      await clearOfflineSyncQueueAsync(scope);
    }
    const available = beginSyncUnlessDeleting(scope, commentOperation(scope));
    assert.ok(available);
    try {
      await assert.rejects(runProtectedDelete(target, async () => undefined), /pending sync/);
    } finally {
      available();
    }
  });
});
