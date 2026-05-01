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
import { getTicketIdForDocument, getTicketIdForUri } from "../views/ticketEditorRegistry";
import { addOfflineCommentUpdate, removeOfflineCommentEntry } from "../views/offlineSyncStore";
import { computeNotesHash } from "../utils/notesHash";
import type { NotificationController } from "./notificationController";
import { classifyDocumentSave } from "./saveSyncClassifier";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";

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
  const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = deps;

  if (editor) {
    let ticketResult = await handleTicketEditorSave(editor, {
      onSubjectUpdated: deps.updateTicketListSubject,
    });
    if (ticketResult) {
      if (ticketResult.status === "conflict" && ticketResult.conflictContext) {
        ticketResult = await handleConflict(ticketResult, editor);
      }
      notifications.notifyTicketSaveResult(ticketResult);
      if (ticketResult.status === "created") {
        ticketsPresentation.refresh();
      }
      return;
    }

    let commentResult = await handleCommentEditorSave(editor);
    if (commentResult) {
      if (commentResult.status === "conflict" && commentResult.conflictContext) {
        commentResult = await handleCommentConflict(commentResult, editor);
      }
      notifications.notifyCommentSaveResult(commentResult);
      if (shouldRefreshComments(commentResult.status)) {
        const ticketId =
          getTicketIdForDocument(editor.document) ??
          getTicketIdForUri(editor.document.uri);
        if (ticketId) {
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
        });
      } else {
        addOfflineCommentUpdate({
          ticketId: classification.parsed.fields.issueId,
          commentId: classification.parsed.fields.journalId,
          body: classification.parsed.body,
          documentUri: document.uri.toString(),
          sourceNotesHash: classification.parsed.fields.sourceNotesHash,
        });
      }
      unsyncedPresentation.refresh();
      return;
    }

    case "localComment": {
      const commentResult = saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        commentId: classification.commentId,
        content: document.getText(),
        documentUri: document.uri,
      });
      notifications.notifyCommentSaveResult(commentResult);
      return;
    }

    case "newTicketDraftContent": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        projectId: classification.projectId,
        documentUri: document.uri,
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
      });
      notifications.notifyTicketSaveResult(result);
      return;
    }

    case "newTicketDraftEditor": {
      if (!editor) {
        return;
      }
      const result = await queueNewTicketDraft({ editor });
      notifications.notifyTicketSaveResult(result);
      return;
    }

    case "newTicketDraftContentFromFilename": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        documentUri: document.uri,
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
      });
      notifications.notifyCommentSaveResult(commentResult);
      return;
    }

    case "draftCommentNew": {
      const commentResult = saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        content: document.getText(),
        documentUri: document.uri,
      });
      notifications.notifyCommentSaveResult(commentResult);
      return;
    }

    case "parsedComment": {
      const commentResult = saveCommentDocumentLocally({
        ticketId: classification.ticketId,
        commentId: classification.commentId,
        content: document.getText(),
        documentUri: document.uri,
      });
      notifications.notifyCommentSaveResult(commentResult);
      unsyncedPresentation.refresh();
      return;
    }

    case "none":
      return;
  }
};
