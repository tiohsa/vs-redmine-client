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
import { addOfflineCommentUpdate, removeOfflineCommentEntry } from "../views/offlineSyncStore";
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

export interface SaveSyncExecutorDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications: NotificationController;
  updateTicketListSubject: (ticketId: number, subject: string) => void;
}

export const performSyncOnSave = async (
  document: vscode.TextDocument,
  editor: vscode.TextEditor | undefined,
  deps: SaveSyncExecutorDeps,
): Promise<void> => {
  const operationScope = getConnectionScopeForDocument(document) ?? getCurrentConnectionScope();
  if (operationScope !== getCurrentConnectionScope()) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }
  const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = deps;
  const refreshQueuedComment = (ticketId: number): void => {
    unsyncedPresentation.refresh();
    commentsPresentation.refreshForTicket(ticketId);
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
        } else if (shouldRefreshComments(commentResult.status)) {
          commentsPresentation.refreshForTicket(ticketId);
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
      } else {
        addOfflineCommentUpdate({
          ticketId: classification.parsed.fields.issueId,
          commentId: classification.parsed.fields.journalId,
          body: classification.parsed.body,
          documentUri: document.uri.toString(),
          sourceNotesHash: classification.parsed.fields.sourceNotesHash,
        }, operationScope);
      }
      unsyncedPresentation.refresh();
      commentsPresentation.refreshForTicket(classification.parsed.fields.issueId);
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
      return;
    }

    case "newTicketDraftEditor": {
      if (!editor) {
        return;
      }
      const result = await queueNewTicketDraft({ editor, operationScope });
      notifications.notifyTicketSaveResult(result);
      return;
    }

    case "newTicketDraftContentFromFilename": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyTicketSaveResult(result);
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
      return;
    }

    case "none":
      return;
  }
};
