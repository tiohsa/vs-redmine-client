import * as vscode from "vscode";
import { handleConflict, handleCommentConflict } from "../views/conflictResolver";
import {
  handleCommentEditorSave,
  saveCommentDocumentLocally,
  shouldRefreshComments,
} from "../views/commentSaveSync";
import {
  handleTicketEditorSave,
  queueNewTicketDraft,
  queueNewTicketDraftContent,
  queueTicketDraft,
} from "../views/ticketSaveSync";
import {
  getConnectionScopeForDocument,
  getTicketIdForDocument,
  getTicketIdForUri,
} from "../views/ticketEditorRegistry";
import {
  addOfflineCommentUpdateAsync,
  getActiveScope,
  removeOfflineCommentEntryAsync,
} from "../views/offlineSyncStore";
import { computeNotesHash } from "../utils/notesHash";
import type { NotificationController } from "./notificationController";
import { classifyDocumentSave } from "./saveSyncClassifier";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { showError } from "../utils/notifications";
import { getOfflineSyncMode, type OfflineSyncMode } from "../config/settings";
import type { SyncEngine, SyncEngineKey, SyncEngineOutcome } from "./syncEngine";
import { createOutcomePresenter } from "./outcomePresenter";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { CommentSaveResult } from "../views/commentSaveTypes";

export interface SaveSyncExecutorDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications: NotificationController;
  updateTicketListSubject: (ticketId: number, subject: string) => void;
  offlineSyncMode?: OfflineSyncMode;
  syncEngine?: Pick<SyncEngine, "syncOne">;
  resolveTicketConflict?: typeof handleConflict;
  resolveCommentConflict?: typeof handleCommentConflict;
}

export const performSyncOnSave = async (
  document: vscode.TextDocument,
  editor: vscode.TextEditor | undefined,
  deps: SaveSyncExecutorDeps,
): Promise<void> => {
  const currentScope = getActiveScope() || getCurrentConnectionScope();
  const operationScope = getConnectionScopeForDocument(document) ?? currentScope;
  if (
    getConnectionScopeForDocument(document) &&
    getConnectionScopeForDocument(document) !== currentScope
  ) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }
  const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = deps;
  const resolveTicketConflict = deps.resolveTicketConflict ?? handleConflict;
  const resolveCommentConflict = deps.resolveCommentConflict ?? handleCommentConflict;
  const syncMode = deps.offlineSyncMode ?? getOfflineSyncMode();
  const presenter = createOutcomePresenter({
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    notifications,
  });

  const refreshQueuedComment = (ticketId: number): void => {
    commentsPresentation.refreshForTicket(ticketId);
  };

  const resolveAutoConflict = async (
    key: SyncEngineKey,
    outcome: SyncEngineOutcome,
  ): Promise<boolean> => {
    if (outcome.kind !== "conflict") {
      return false;
    }

    if (
      editor &&
      key.kind === "ticket" &&
      "conflictContext" in outcome &&
      outcome.conflictContext
    ) {
      const result: TicketSaveResult = await resolveTicketConflict(
        {
          status: "conflict",
          message: outcome.message ?? vscode.l10n.t("Remote changes detected. Review diff before syncing."),
          conflictContext: outcome.conflictContext,
        },
        editor,
        undefined,
        operationScope,
        deps.syncEngine,
      );
      notifications.notifyTicketSaveResult(result);
      if (result.status === "created") {
        ticketsPresentation.refresh();
      } else {
        ticketsPresentation.notifyChange();
      }
      unsyncedPresentation.refresh();
      return true;
    }

    if (
      editor &&
      key.kind === "comment" &&
      "commentConflictContext" in outcome &&
      outcome.commentConflictContext
    ) {
      const result: CommentSaveResult = await resolveCommentConflict(
        {
          status: "conflict",
          message: outcome.message ?? vscode.l10n.t("Comment was updated in Redmine. Review diff before syncing."),
          commentId: outcome.commentConflictContext.commentId,
          conflictContext: outcome.commentConflictContext,
        },
        editor,
        operationScope,
        deps.syncEngine,
      );
      notifications.notifyCommentSaveResult(result);
      if (shouldRefreshComments(result.status)) {
        commentsPresentation.refreshForTicket(key.ticketId);
      }
      unsyncedPresentation.refresh();
      return true;
    }

    if (key.kind === "comment") {
      notifications.notifyCommentSaveResult({
        status: "conflict",
        message: outcome.message ?? vscode.l10n.t("A conflict was detected while synchronizing."),
        commentId: key.commentId,
      });
      commentsPresentation.refreshForTicket(key.ticketId);
      unsyncedPresentation.refresh();
      return true;
    }

    return false;
  };

  const syncIfAuto = async (key: SyncEngineKey): Promise<void> => {
    if (syncMode === "auto" && deps.syncEngine && key.kind !== "newTicket") {
      try {
        const outcome = await deps.syncEngine.syncOne(key, { connectionScope: operationScope });
        if (!(await resolveAutoConflict(key, outcome))) {
          presenter.present(outcome, {
            ticketId: key.kind === "ticket" ? key.ticketId : (key.kind === "comment" ? key.ticketId : undefined),
            commentId: key.kind === "comment" ? key.commentId : undefined,
            isAuto: true,
          });
        }
      } catch (error) {
        presenter.present(
          { kind: "failed_before_commit", error: error as Error },
          {
            ticketId: key.kind === "ticket" ? key.ticketId : (key.kind === "comment" ? key.ticketId : undefined),
            commentId: key.kind === "comment" ? key.commentId : undefined,
            isAuto: true,
          },
        );
      }
    } else {
      unsyncedPresentation.refresh();
    }
  };

  if (editor) {
    let ticketResult = await handleTicketEditorSave(editor, {
      onSubjectUpdated: deps.updateTicketListSubject,
      operationScope,
    });
    if (ticketResult) {
      if (ticketResult.status === "conflict" && ticketResult.conflictContext) {
        ticketResult = await resolveTicketConflict(
          ticketResult,
          editor,
          undefined,
          operationScope,
          deps.syncEngine,
        );
      }
      notifications.notifyTicketSaveResult(ticketResult);
      if (ticketResult.status === "created") {
        ticketsPresentation.refresh();
        unsyncedPresentation.refresh();
      } else if (ticketResult.status === "queued") {
        const ticketId = getTicketIdForDocument(editor.document) ?? getTicketIdForUri(editor.document.uri);
        if (ticketId && ticketId > 0) {
          await syncIfAuto({ kind: "ticket", ticketId });
        } else {
          unsyncedPresentation.refresh();
        }
      }
      return;
    }

    let commentResult = await handleCommentEditorSave(editor, undefined, operationScope);
    if (commentResult) {
      if (commentResult.status === "conflict" && commentResult.conflictContext) {
        commentResult = await resolveCommentConflict(
          commentResult,
          editor,
          operationScope,
          deps.syncEngine,
        );
      }
      notifications.notifyCommentSaveResult(commentResult);
      const ticketId =
        getTicketIdForDocument(editor.document) ??
        getTicketIdForUri(editor.document.uri);
      if (ticketId) {
        if (commentResult.status === "queued") {
          refreshQueuedComment(ticketId);
          await syncIfAuto({
            kind: "comment",
            ticketId,
            documentUri: editor.document.uri.toString(),
          });
        } else if (shouldRefreshComments(commentResult.status)) {
          commentsPresentation.refreshForTicket(ticketId);
          unsyncedPresentation.refresh();
        }
      }
      return;
    }
  }

  const classification = classifyDocumentSave(document, editor);

  switch (classification.kind) {
    case "commentUpdateFile": {
      const currentHash = computeNotesHash(classification.parsed.body);
      if (currentHash === classification.parsed.fields.sourceNotesHash) {
        await removeOfflineCommentEntryAsync({
          commentId: classification.parsed.fields.journalId,
          documentUri: document.uri.toString(),
        }, operationScope);
        unsyncedPresentation.refresh();
        commentsPresentation.refreshForTicket(classification.parsed.fields.issueId);
      } else {
        await addOfflineCommentUpdateAsync({
          ticketId: classification.parsed.fields.issueId,
          commentId: classification.parsed.fields.journalId,
          body: classification.parsed.body,
          documentUri: document.uri.toString(),
          sourceNotesHash: classification.parsed.fields.sourceNotesHash,
        }, operationScope);
        commentsPresentation.refreshForTicket(classification.parsed.fields.issueId);
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.parsed.fields.issueId,
          commentId: classification.parsed.fields.journalId,
          documentUri: document.uri.toString(),
        });
      }
      return;
    }

    case "localComment": {
      const commentResult = await saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        commentId: classification.commentId,
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyCommentSaveResult(commentResult);
      refreshQueuedComment(classification.ticketId);
      if (commentResult.status === "queued") {
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.ticketId,
          commentId: classification.commentId,
          documentUri: document.uri.toString(),
        });
      } else {
        unsyncedPresentation.refresh();
      }
      return;
    }

    case "newTicketDraftContent": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        projectId: classification.projectId,
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyTicketSaveResult(result);
      unsyncedPresentation.refresh();
      return;
    }

    case "existingTicket":
    case "existingDraftTicket":
    case "parsedTicket": {
      const result = await queueTicketDraft({
        ticketId: classification.ticketId,
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyTicketSaveResult(result);
      if (result.status === "queued") {
        await syncIfAuto({ kind: "ticket", ticketId: classification.ticketId });
      } else {
        unsyncedPresentation.refresh();
      }
      return;
    }

    case "newTicketDraftEditor": {
      if (!editor) {
        return;
      }
      const result = await queueNewTicketDraft({ editor, operationScope });
      notifications.notifyTicketSaveResult(result);
      unsyncedPresentation.refresh();
      return;
    }

    case "newTicketDraftContentFromFilename": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyTicketSaveResult(result);
      unsyncedPresentation.refresh();
      return;
    }

    case "draftCommentExisting": {
      const commentResult = await saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        commentId: classification.commentId,
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyCommentSaveResult(commentResult);
      refreshQueuedComment(classification.ticketId);
      if (commentResult.status === "queued") {
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.ticketId,
          commentId: classification.commentId,
          documentUri: document.uri.toString(),
        });
      } else {
        unsyncedPresentation.refresh();
      }
      return;
    }

    case "draftCommentNew": {
      const commentResult = await saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyCommentSaveResult(commentResult);
      refreshQueuedComment(classification.ticketId);
      if (commentResult.status === "queued") {
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.ticketId,
          documentUri: document.uri.toString(),
        });
      } else {
        unsyncedPresentation.refresh();
      }
      return;
    }

    case "parsedComment": {
      const commentResult = await saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        commentId: classification.commentId,
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyCommentSaveResult(commentResult);
      refreshQueuedComment(classification.ticketId);
      if (commentResult.status === "queued") {
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.ticketId,
          commentId: classification.commentId,
          documentUri: document.uri.toString(),
        });
      } else {
        unsyncedPresentation.refresh();
      }
      return;
    }

    case "none":
      return;
  }
};
