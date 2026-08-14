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
import { getOfflineSyncMode, type OfflineSyncMode } from "../config/settings";
import { createSyncEngine, type SyncEngine } from "./syncEngine";

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
  const operationScope = getConnectionScopeForDocument(document) ?? getCurrentConnectionScope();
  if (operationScope !== getCurrentConnectionScope()) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }
  const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = deps;
  const syncMode = deps.offlineSyncMode ?? getOfflineSyncMode();
  const syncEngine = deps.syncEngine ?? createSyncEngine();

  const refreshQueuedComment = (ticketId: number): void => {
    unsyncedPresentation.refresh();
    commentsPresentation.refreshForTicket(ticketId);
  };

  const syncIfAuto = async (key: import("./syncEngine").SyncEngineKey): Promise<void> => {
    if (syncMode === "auto" && key.kind !== "newTicket") {
      try {
        const outcome = await syncEngine.syncOne(key, { connectionScope: operationScope });
        if (outcome.kind === "completed" || outcome.kind === "no_change") {
          unsyncedPresentation.refresh();
          if (key.kind === "ticket") {
            ticketsPresentation.notifyChange();
          } else if (key.kind === "comment") {
            commentsPresentation.refreshForTicket(key.ticketId);
          }
        }
      } catch {
        // 同期失敗時のエラーハンドリングは syncEngine 内で durable state として記録される
      }
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
      } else if (ticketResult.status === "queued") {
        const ticketId = getTicketIdForDocument(editor.document) ?? getTicketIdForUri(editor.document.uri);
        if (ticketId && ticketId > 0) {
          await syncIfAuto({ kind: "ticket", ticketId });
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
        unsyncedPresentation.refresh();
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
      }
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
      if (commentResult.status === "queued") {
        await syncIfAuto({
          kind: "comment",
          ticketId: classification.ticketId,
          commentId: classification.commentId,
          documentUri: document.uri.toString(),
        });
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
      }
      return;
    }

    case "none":
      return;
  }
};
