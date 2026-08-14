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
  addOfflineCommentUpdate,
  getActiveScope,
  removeOfflineCommentEntry,
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
import type { SyncEngine } from "./syncEngine";
import { createOutcomePresenter } from "./outcomePresenter";

export interface SaveSyncExecutorDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications: NotificationController;
  updateTicketListSubject: (ticketId: number, subject: string) => void;
  offlineSyncMode?: OfflineSyncMode;
  syncEngine?: SyncEngine;
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
  const syncMode = deps.offlineSyncMode ?? (deps.syncEngine ? "auto" : getOfflineSyncMode());
  const presenter = createOutcomePresenter({
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    notifications,
  });

  const refreshQueuedComment = (ticketId: number): void => {
    commentsPresentation.refreshForTicket(ticketId);
  };

  const syncIfAuto = async (key: import("./syncEngine").SyncEngineKey): Promise<void> => {
    if (syncMode === "auto" && deps.syncEngine && key.kind !== "newTicket") {
      try {
        const outcome = await deps.syncEngine.syncOne(key, { connectionScope: operationScope });
        presenter.present(outcome as any, {
          ticketId: key.kind === "ticket" ? key.ticketId : (key.kind === "comment" ? key.ticketId : undefined),
          commentId: key.kind === "comment" ? key.commentId : undefined,
          isAuto: true,
        });
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
        ticketResult = await handleConflict(ticketResult, editor, undefined, operationScope);
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
        commentResult = await handleCommentConflict(commentResult, editor, operationScope);
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
        removeOfflineCommentEntry({
          commentId: classification.parsed.fields.journalId,
          documentUri: document.uri.toString(),
        }, operationScope);
        unsyncedPresentation.refresh();
        commentsPresentation.refreshForTicket(classification.parsed.fields.issueId);
      } else {
        addOfflineCommentUpdate({
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
      const commentResult = saveCommentDocumentLocally({
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
      const commentResult = saveCommentDocumentLocally({
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
      const commentResult = saveCommentDocumentLocally({
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
      const commentResult = saveCommentDocumentLocally({
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
