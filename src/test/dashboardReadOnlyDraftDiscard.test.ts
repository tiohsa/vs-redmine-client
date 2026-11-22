import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { beginSyncUnlessDeleting } from "../app/ticketSync/syncDeletionGuard";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardMessageRouter } from "../dashboard/DashboardMessageRouter";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { computeNotesHash } from "../utils/notesHash";
import { clearCommentDraft, getCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { clearCommentEdit, getCommentEdit, initializeCommentEdit, setCommentDraftBody } from "../views/commentEditStore";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { addOfflineTicketUpdateAsync, clearOfflineSyncQueueAsync, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { clearTicketDraft, getTicketDraft, initializeTicketDraft, markDraftStatus, setTicketDraftContent } from "../views/ticketDraftStore";
import { withConfiguration } from "./helpers/configuration";

const metadata = { tracker: "Bug", priority: "Normal", status: "New", due_date: "" };

interface Fixture {
  scope: string;
  store: DashboardStateStore;
  controller: DashboardController;
  discard(itemId: string): Promise<void>;
  answers: Array<(() => Promise<string | undefined>) | string | undefined>;
  errors: string[];
  prompts: string[];
}

function withDiscardFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  return withConfiguration("baseUrl", "https://discard-local-draft.invalid/", async () => {
    const scope = getCurrentConnectionScope();
    const store = new DashboardStateStore();
    const answers: Fixture["answers"] = [];
    const errors: string[] = [];
    const prompts: string[] = [];
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: (_id, value) => { errors.push(value); },
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    const router = new DashboardMessageRouter(controller);
    const prompt = vscode.window.showWarningMessage;
    try {
      vscode.window.showWarningMessage = async (message: string, options?: vscode.MessageOptions) => {
        prompts.push([message, options?.detail].filter(Boolean).join("\n"));
        const answer = answers.shift();
        return typeof answer === "function" ? await answer() : answer;
      };
      await run({ scope, store, controller, answers, errors, prompts,
        discard: itemId => router.route({ type: "unsynced.discardPendingChange", requestId: "discard-local", itemId }) });
    } finally {
      vscode.window.showWarningMessage = prompt;
      controller.dispose();
      await clearOfflineSyncQueueAsync(scope);
    }
  });
}

suite("Unsynced の読み取り専用下書きの破棄", () => {
  test("3種類の下書きを破棄し、同一内容の保存元をまとめ、キューと別接続先を保持する", async () => {
    await withDiscardFixture(async ({ scope, store, controller, discard, answers, prompts, errors }) => {
      const foreign = `${scope}another/`;
      const ticketId = 421;
      const draftTicketId = 422;
      const commentTicketId = 423;
      const commentId = 892;
      const editText = "discard this update";
      initializeTicketDraft(ticketId, "server", "saved description", metadata, undefined, scope);
      setTicketDraftContent(ticketId, { subject: "locally edited", description: "", metadata }, scope);
      markDraftStatus(ticketId, "Dirty", scope);
      setCommentDraft(draftTicketId, "draft comment", scope);
      setCommentDraft(draftTicketId, "separate instance", foreign);
      setCommentDraft(commentTicketId, buildCommentUpdateFileContent({ issueId: commentTicketId, journalId: commentId,
        sourceNotesHash: computeNotesHash("server comment") }, editText), scope);
      const { lastSavedAt } = initializeCommentEdit(commentId, commentTicketId, "server comment", undefined, scope);
      setCommentDraftBody(commentId, editText, scope);
      initializeCommentEdit(commentId + 1, commentTicketId, "another server comment", undefined, scope);
      setCommentDraftBody(commentId + 1, "keep the other comment", scope);
      try {
        await addOfflineTicketUpdateAsync(ticketId, { ticketId, subject: "queued earlier", description: "old queued content",
          baseSubject: "server", baseDescription: "saved description", baseMetadata: metadata, metadata }, scope);
        const previousQueue = getOfflineSyncQueue(scope);
        controller.refreshUnsyncedPresentation();
        const visible = store.getState().unsynced;
        assert.strictEqual(visible.totalCount, 5);
        const ticket = visible.localChanges?.find(row => row.detail.includes(`#${ticketId}`));
        const newComment = visible.localChanges?.find(row => row.detail.includes(`#${draftTicketId}`));
        const comment = visible.localChanges?.find(row => row.detail.includes(`#${commentId}`));
        assert.ok(ticket?.canDiscard && newComment?.canDiscard && comment?.canDiscard);
        assert.strictEqual(comment.focusIds.length, 2);

        answers.push(undefined);
        await discard(ticket.id);
        assert.strictEqual(getTicketDraft(ticketId, scope)?.draftSubject, "locally edited");
        assert.strictEqual(store.getState().unsynced.totalCount, 5);

        answers.push("Discard draft", "Discard draft", "Discard draft");
        await discard(ticket.id);
        await discard(newComment.id);
        await discard(comment.id);
        assert.deepStrictEqual(errors, []);
        assert.match(prompts.at(-1) ?? "", /#892.*#423|#423.*#892/);
        assert.strictEqual(getTicketDraft(ticketId, scope)?.baseDescription, "saved description");
        assert.strictEqual(getTicketDraft(ticketId, scope)?.draftSubject, undefined);
        assert.strictEqual(getCommentDraft(draftTicketId, scope), "");
        assert.strictEqual(getCommentDraft(draftTicketId, foreign), "separate instance");
        assert.strictEqual(getCommentDraft(commentTicketId, scope), "");
        assert.strictEqual(getCommentEdit(commentId, scope)?.baseBody, "server comment");
        assert.strictEqual(getCommentEdit(commentId, scope)?.lastSavedAt, lastSavedAt);
        assert.strictEqual(getCommentEdit(commentId, scope)?.draftBody, undefined);
        assert.strictEqual(getCommentEdit(commentId + 1, scope)?.draftBody, "keep the other comment");
        assert.deepStrictEqual(getOfflineSyncQueue(scope), previousQueue);
        assert.strictEqual(store.getState().unsynced.totalCount, 2);
      } finally {
        clearTicketDraft(ticketId, scope);
        clearCommentDraft(draftTicketId, scope);
        clearCommentDraft(draftTicketId, foreign);
        clearCommentDraft(commentTicketId, scope);
        clearCommentEdit(commentId, scope);
        clearCommentEdit(commentId + 1, scope);
      }
    });
  });

  test("確認中に内容変更・未保存エディター・同期開始・接続先変更が起きた場合は保持する", async () => {
    await withDiscardFixture(async ({ scope, store, controller, discard, answers, errors }) => {
      const ticketId = 425;
      initializeTicketDraft(ticketId, "base", "", metadata, undefined, scope);
      const setDraft = (subject: string): void => {
        setTicketDraftContent(ticketId, { subject, description: "", metadata }, scope);
        markDraftStatus(ticketId, "Dirty", scope);
      };
      setDraft("reviewed");
      const rowId = (): string => {
        controller.refreshUnsyncedPresentation();
        const row = store.getState().unsynced.localChanges?.find(value => value.detail.includes(`#${ticketId}`));
        assert.ok(row?.canDiscard);
        return row.id;
      };
      let releaseSync: (() => void) | undefined;
      const uri = vscode.Uri.from({ scheme: "untitled", path: `/${getConnectionScopeHash(scope)}/redmine-client-ticket-${ticketId}.md` });
      let editedDoc: vscode.TextDocument | undefined;
      try {
        answers.push(async () => { setDraft("edited while confirming"); return "Discard draft"; });
        await discard(rowId());
        assert.strictEqual(getTicketDraft(ticketId, scope)?.draftSubject, "edited while confirming");

        answers.push(async () => {
          releaseSync = beginSyncUnlessDeleting(scope, { operationId: "draft-race", ticketId, connectionScope: scope,
            phase: "preparing", kind: "ticket_update", persistenceVersion: 1, revision: 1 });
          assert.ok(releaseSync);
          return "Discard draft";
        });
        await discard(rowId());
        assert.strictEqual(getTicketDraft(ticketId, scope)?.draftSubject, "edited while confirming");
        releaseSync?.();
        releaseSync = undefined;

        answers.push(async () => {
          editedDoc = await vscode.workspace.openTextDocument(uri);
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, new vscode.Position(0, 0), "Unsaved scratch edit");
          assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
          assert.strictEqual(editedDoc.isDirty, true);
          return "Discard draft";
        });
        await discard(rowId());
        assert.strictEqual(getTicketDraft(ticketId, scope)?.draftSubject, "edited while confirming");
        assert.strictEqual(errors.length, 3);

        setCommentDraft(ticketId, "kept during connection switch", scope);
        controller.refreshUnsyncedPresentation();
        const comment = store.getState().unsynced.localChanges?.find(item => item.label === "Comment draft");
        assert.ok(comment?.canDiscard);
        answers.push(async () => {
          await vscode.workspace.getConfiguration("redmine-client").update("baseUrl", `${scope}another/`, vscode.ConfigurationTarget.Global);
          return "Discard draft";
        });
        await discard(comment.id);
        assert.strictEqual(getCommentDraft(ticketId, scope), "kept during connection switch");
        assert.strictEqual(errors.length, 4);
      } finally {
        releaseSync?.();
        if (editedDoc) {
          const cleanup = new vscode.WorkspaceEdit();
          cleanup.delete(uri, new vscode.Range(0, 0, 0, editedDoc.lineAt(0).text.length));
          await vscode.workspace.applyEdit(cleanup);
        }
        clearTicketDraft(ticketId, scope);
        clearCommentDraft(ticketId, scope);
      }
    });
  });
});
