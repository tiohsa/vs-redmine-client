import * as path from "path";
import * as vscode from "vscode";
import { syncEditorToRedmine } from "../commands/syncToRedmine";
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
  getCommentIdForDocument,
  getCommentIdForDraftUri,
  getCommentIdForUri,
  getEditorContentTypeForDocument,
  getEditorContentTypeForUri,
  getProjectIdForDocument,
  getProjectIdForUri,
  getTicketIdForDocument,
  getTicketIdForDraftUri,
  getTicketIdForUri,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import {
  isNewTicketDraftFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import {
  isCommentUpdateFilename,
  parseCommentUpdateFile,
} from "../views/commentUpdateFile";
import { addOfflineCommentUpdate, removeOfflineCommentEntry } from "../views/offlineSyncStore";
import { computeNotesHash } from "../utils/notesHash";
import type { CommentsTreeProvider } from "../views/commentsView";
import type { TicketsTreeProvider } from "../views/ticketsView";
import type { UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import type { NotificationController } from "./notificationController";

export type SyncStatus = "uploaded" | "noChange" | "conflict" | "failed";

const toSyncStatus = (s: string): SyncStatus =>
  s === "updated" || s === "created"
    ? "uploaded"
    : s === "noChange"
      ? "noChange"
      : s === "conflict"
        ? "conflict"
        : "failed";

export interface SyncControllerDeps {
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  notifications: NotificationController;
  registerEditorDocument: (document: vscode.TextDocument) => void;
}

export interface SyncController {
  updateTicketListSubject: (ticketId: number, subject: string) => void;
  syncEditorAndNotify: (editor: vscode.TextEditor) => Promise<SyncStatus>;
  syncOnSave: (document: vscode.TextDocument) => void;
}

export const createSyncController = (deps: SyncControllerDeps): SyncController => {
  const { ticketsProvider, commentsProvider, unsyncedFilesProvider, notifications } = deps;

  const updateTicketListSubject = (ticketId: number, subject: string): void => {
    ticketsProvider.updateTicketSubject(ticketId, subject);
  };

  const syncEditorAndNotify = async (editor: vscode.TextEditor): Promise<SyncStatus> => {
    try {
      const syncResult = await syncEditorToRedmine(editor, {
        onSubjectUpdated: updateTicketListSubject,
        onTicketCreated: () => ticketsProvider.refresh(),
        onCommentsRefresh: (ticketId) => commentsProvider.refreshForTicket(ticketId),
      });
      if (!syncResult) {
        return "failed";
      }
      if (syncResult.kind === "ticket") {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleConflict(result, editor);
        }
        notifications.notifyTicketSaveResult(result);
        if (result.status === "created") {
          ticketsProvider.refresh();
        } else {
          ticketsProvider.notifyChange();
        }
        return toSyncStatus(result.status);
      } else {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleCommentConflict(result, editor);
        }
        notifications.notifyCommentSaveResult(result);
        if (shouldRefreshComments(result.status)) {
          commentsProvider.refreshForTicket(syncResult.ticketId);
        }
        return toSyncStatus(result.status);
      }
    } catch {
      return "failed";
    }
  };

  const syncOnSave = (document: vscode.TextDocument): void => {
    // untitled→file 保存時に onDidOpenTextDocument より先に発火するケースがあるため明示的に登録する。
    deps.registerEditorDocument(document);
    const editor =
      vscode.window.visibleTextEditors.find((candidate) => candidate.document === document) ??
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined);

    void (async () => {
      if (editor) {
        let ticketResult = await handleTicketEditorSave(editor, {
          onSubjectUpdated: updateTicketListSubject,
        });
        if (ticketResult) {
          if (ticketResult.status === "conflict" && ticketResult.conflictContext) {
            ticketResult = await handleConflict(ticketResult, editor);
          }
          notifications.notifyTicketSaveResult(ticketResult);
          if (ticketResult.status === "created") {
            ticketsProvider.refresh();
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
              commentsProvider.refreshForTicket(ticketId);
            }
          }
          return;
        }
      }

      // comment-update ファイルの保存検知: 本文変更があればキューに追加する
      if (isCommentUpdateFilename(path.basename(document.uri.path))) {
        const parsed = parseCommentUpdateFile(document.getText());
        if (parsed) {
          const currentHash = computeNotesHash(parsed.body);
          if (currentHash === parsed.fields.sourceNotesHash) {
            // 本文が元コメントと同一 → 未同期扱いしない
            removeOfflineCommentEntry({
              commentId: parsed.fields.journalId,
              documentUri: document.uri.toString(),
            });
          } else {
            addOfflineCommentUpdate({
              ticketId: parsed.fields.issueId,
              commentId: parsed.fields.journalId,
              body: parsed.body,
              documentUri: document.uri.toString(),
              sourceNotesHash: parsed.fields.sourceNotesHash,
            });
          }
          unsyncedFilesProvider.refresh();
        }
        return;
      }

      const commentIdForDocument =
        getCommentIdForDocument(document) ?? getCommentIdForUri(document.uri);
      if (commentIdForDocument) {
        const ticketIdForDocument =
          getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
        if (!ticketIdForDocument) {
          return;
        }
        const commentResult = saveCommentDocumentLocally({
          ticketId: ticketIdForDocument,
          commentId: commentIdForDocument,
          content: document.getText(),
          documentUri: document.uri,
        });
        notifications.notifyCommentSaveResult(commentResult);
        return;
      }

      const ticketIdForDocument =
        getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
      const contentTypeForDocument =
        getEditorContentTypeForDocument(document) ??
        getEditorContentTypeForUri(document.uri);
      if (ticketIdForDocument && contentTypeForDocument === "ticket") {
        if (ticketIdForDocument === NEW_TICKET_DRAFT_ID) {
          const projectId =
            getProjectIdForDocument(document) ?? getProjectIdForUri(document.uri);
          const result = await queueNewTicketDraftContent({
            content: document.getText(),
            projectId,
            documentUri: document.uri,
          });
          notifications.notifyTicketSaveResult(result);
          return;
        }

        const result = await queueTicketDraft({
          ticketId: ticketIdForDocument,
          content: document.getText(),
          documentUri: document.uri,
        });
        notifications.notifyTicketSaveResult(result);
        return;
      }

      const filename = path.basename(document.uri.path);
      const parsed = parseEditorFilename(filename);
      if (!parsed) {
        const draftTicketId = parseNewCommentDraftFilename(filename);
        if (!draftTicketId) {
          if (!isNewTicketDraftFilename(filename)) {
            return;
          }

          const existingTicketId = getTicketIdForDraftUri(document.uri.toString());
          if (existingTicketId && existingTicketId !== NEW_TICKET_DRAFT_ID) {
            const result = await queueTicketDraft({
              ticketId: existingTicketId,
              content: document.getText(),
              documentUri: document.uri,
            });
            notifications.notifyTicketSaveResult(result);
            return;
          }

          if (editor) {
            const result = await queueNewTicketDraft({ editor });
            notifications.notifyTicketSaveResult(result);
            return;
          }

          const result = await queueNewTicketDraftContent({
            content: document.getText(),
            documentUri: document.uri,
          });
          notifications.notifyTicketSaveResult(result);
          return;
        }

        const existingCommentId =
          getCommentIdForDocument(document) ??
          getCommentIdForUri(document.uri) ??
          getCommentIdForDraftUri(draftTicketId, document.uri.toString());
        if (existingCommentId) {
          const commentResult = saveCommentDocumentLocally({
            ticketId: draftTicketId,
            commentId: existingCommentId,
            content: document.getText(),
            documentUri: document.uri,
          });
          notifications.notifyCommentSaveResult(commentResult);
          return;
        }

        const result = saveCommentDocumentLocally({
          ticketId: draftTicketId,
          content: document.getText(),
          documentUri: document.uri,
        });
        notifications.notifyCommentSaveResult(result);
        return;
      }

      if (parsed.type === "ticket") {
        const result = await queueTicketDraft({
          ticketId: parsed.ticketId,
          content: document.getText(),
          documentUri: document.uri,
        });
        notifications.notifyTicketSaveResult(result);
        return;
      }

      const commentResult = saveCommentDocumentLocally({
        ticketId: parsed.ticketId,
        commentId: parsed.commentId,
        content: document.getText(),
        documentUri: document.uri,
      });
      notifications.notifyCommentSaveResult(commentResult);
      unsyncedFilesProvider.refresh();
    })();
  };

  return { updateTicketListSubject, syncEditorAndNotify, syncOnSave };
};
