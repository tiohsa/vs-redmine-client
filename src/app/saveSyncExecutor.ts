import * as vscode from "vscode";
import { handleConflict, handleCommentConflict } from "../views/conflictResolver";
import {
  handleCommentEditorSave,
  shouldRefreshComments,
} from "../views/commentSaveSync";
import {
  handleTicketEditorSave,
  queueNewTicketDraft,
  queueNewTicketDraftContent,
  queueTicketDraft,
} from "../views/ticketSaveSync";
import {
  getCommentIdForEditor,
  getConnectionScopeForDocument,
  getTicketIdForDocument,
  getTicketIdForUri,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import { updateTicketDraftStatusFromDocument } from "./editorDocumentPreview";
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
import type { SyncEngine, SyncEngineKey } from "./syncEngine";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { CommentSaveResult } from "../views/commentSaveTypes";
import { invalidCommentUpdateMetadataMessage } from "../views/commentUpdateFile";
import { saveLocalCommentDocument } from "./saveSyncLocalComment";
import { finishExistingTicketDocumentSave, finishNewTicketDocumentSave } from "./saveSyncLocalTicket";
import { createSaveSyncAutoSync } from "./saveSyncAutoSync";

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
  savedContent = document.getText(),
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
  const syncIfAuto = createSaveSyncAutoSync({
    editor,
    operationScope,
    syncMode,
    syncEngine: deps.syncEngine,
    resolveTicketConflict,
    resolveCommentConflict,
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    notifications,
  });

  const refreshQueuedComment = (ticketId: number): void => {
    commentsPresentation.refreshForTicket(ticketId);
  };


  const finishNewTicketSave = async (result: TicketSaveResult): Promise<void> => {
    await finishNewTicketDocumentSave(document, result, { notifications, unsyncedPresentation, syncIfAuto });
  };

  const newTicketKey: SyncEngineKey = { kind: "newTicket", documentUri: document.uri.toString() };

  const finishExistingTicketSave = async (
    ticketId: number,
    status: "queued" | "no_change",
  ): Promise<void> => {
    await finishExistingTicketDocumentSave(document, savedContent, ticketId, status, {
      notifications,
      ticketsPresentation,
      unsyncedPresentation,
      syncIfAuto,
      updateDraftStatusFromDocument: (savedDocument) => {
        updateTicketDraftStatusFromDocument(savedDocument);
      },
      shouldAutoSync: syncMode === "auto" && Boolean(deps.syncEngine),
    });
  };

  if (editor) {
    let ticketResult = await handleTicketEditorSave(editor, {
      onSubjectUpdated: deps.updateTicketListSubject,
      operationScope,
      savedContent,
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
      } else if (ticketResult.status === "queued" || ticketResult.status === "no_change") {
        const ticketId = getTicketIdForDocument(editor.document) ?? getTicketIdForUri(editor.document.uri);
        if (ticketId && ticketId > 0) {
          await finishExistingTicketSave(ticketId, ticketResult.status);
        } else if (ticketResult.status === "queued") {
          if (ticketId === NEW_TICKET_DRAFT_ID) {
            await syncIfAuto(newTicketKey);
          } else {
            unsyncedPresentation.refresh();
          }
        }
      }
      return;
    }

    const existingCommentId = getCommentIdForEditor(editor);
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
          await syncIfAuto(
            {
              kind: "comment",
              ticketId,
              documentUri: editor.document.uri.toString(),
            },
            { isNewComment: existingCommentId === undefined },
          );
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
          ticketId: classification.parsed.fields.issueId,
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

    case "invalidCommentUpdateFile":
      notifications.notifyCommentSaveResult({
        status: "failed",
        message: invalidCommentUpdateMetadataMessage(),
      });
      unsyncedPresentation.refresh();
      return;

    case "localComment":
    case "draftCommentExisting":
    case "draftCommentNew":
    case "parsedComment": {
      const commentId = "commentId" in classification ? classification.commentId : undefined;
      await saveLocalCommentDocument(document, classification.ticketId, commentId, {
        notifications,
        refreshComments: refreshQueuedComment,
        refreshUnsynced: () => unsyncedPresentation.refresh(),
        syncIfAuto,
        operationScope,
      });
      return;
    }

    case "newTicketDraftContent": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        projectId: classification.projectId,
        documentUri: document.uri,
        operationScope,
      });
      await finishNewTicketSave(result);
      return;
    }

    case "existingTicket":
    case "existingDraftTicket":
    case "parsedTicket": {
      const result = await queueTicketDraft({
        ticketId: classification.ticketId,
        content: savedContent,
        documentUri: document.uri,
        operationScope,
      });
      notifications.notifyTicketSaveResult(result);
      if (result.status === "queued" || result.status === "no_change") {
        await finishExistingTicketSave(classification.ticketId, result.status);
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
      await finishNewTicketSave(result);
      return;
    }

    case "newTicketDraftContentFromFilename": {
      const result = await queueNewTicketDraftContent({
        content: document.getText(),
        documentUri: document.uri,
        operationScope,
      });
      await finishNewTicketSave(result);
      return;
    }

    case "none":
      return;
  }
};
