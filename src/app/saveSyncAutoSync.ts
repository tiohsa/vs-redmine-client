import * as vscode from "vscode";
import { handleConflict, handleCommentConflict } from "../views/conflictResolver";
import { shouldRefreshComments } from "../views/commentSaveSync";
import { getProjectIdForUri } from "../views/ticketEditorRegistry";
import { renameSyncedNewTicketFileIfEligible } from "../views/ticketSync/ticketEditorRewrite";
import { refreshTicketEditorContexts } from "./editorEventController";
import { markDraftStatus } from "../views/ticketDraftStore";
import type { NotificationController } from "./notificationController";
import type { CommentPresentationPort, TicketPresentationPort, UnsyncedPresentationPort } from "./presentationPorts";
import type { OfflineSyncMode } from "../config/settings";
import type { SyncEngine, SyncEngineKey, SyncEngineOutcome } from "./syncEngine";
import { createOutcomePresenter } from "./outcomePresenter";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { CommentSaveResult } from "../views/commentSaveTypes";

export interface SaveSyncAutoSyncDeps {
  editor: vscode.TextEditor | undefined;
  operationScope: string;
  syncMode: OfflineSyncMode;
  syncEngine?: Pick<SyncEngine, "syncOne">;
  resolveTicketConflict: typeof handleConflict;
  resolveCommentConflict: typeof handleCommentConflict;
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications: NotificationController;
}

export const createSaveSyncAutoSync = (deps: SaveSyncAutoSyncDeps) => {
  const {
    editor,
    operationScope,
    syncMode,
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    notifications,
  } = deps;
  const presenter = createOutcomePresenter({
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    notifications,
  });

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
      const result: TicketSaveResult = await deps.resolveTicketConflict(
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
      switch (result.status) {
        case "created":
        case "success":
        case "no_change":
          markDraftStatus(key.ticketId, "Synced", operationScope);
          break;
        case "merged":
          markDraftStatus(key.ticketId, "Dirty", operationScope);
          break;
        case "queued":
          markDraftStatus(key.ticketId, "Queued", operationScope);
          break;
        case "conflict":
          markDraftStatus(key.ticketId, "Conflict", operationScope);
          break;
        default:
          markDraftStatus(key.ticketId, "Failed", operationScope);
      }
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
      const result: CommentSaveResult = await deps.resolveCommentConflict(
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

  return async (
    key: SyncEngineKey,
    options?: { isNewComment?: boolean },
  ): Promise<void> => {
    if (syncMode === "auto" && deps.syncEngine) {
      if (key.kind === "ticket") {
        markDraftStatus(key.ticketId, "Syncing", operationScope);
      }
      try {
        const outcome = await deps.syncEngine.syncOne(key, { connectionScope: operationScope });
        const createdTicketId =
          key.kind === "newTicket" &&
          outcome.kind === "completed" &&
          "ticketId" in outcome &&
          typeof outcome.ticketId === "number" &&
          outcome.ticketId > 0
            ? outcome.ticketId
            : undefined;
        const isNewComment =
          key.kind === "comment" &&
          (options?.isNewComment ?? (key.commentId === undefined));
        const createdCommentId =
          isNewComment &&
          outcome.kind === "completed" &&
          "commentId" in outcome &&
          typeof outcome.commentId === "number" &&
          outcome.commentId > 0
            ? outcome.commentId
            : undefined;
        if (key.kind === "newTicket" && outcome.kind === "completed") {
          if (key.documentUri && createdTicketId !== undefined) {
            const oldUri = vscode.Uri.parse(key.documentUri);
            await renameSyncedNewTicketFileIfEligible({
              oldUri,
              ticketId: createdTicketId,
              projectId: getProjectIdForUri(oldUri),
              connectionScope: operationScope,
            });
            refreshTicketEditorContexts(vscode.window.activeTextEditor);
          }
        }
        const conflictHandled = await resolveAutoConflict(key, outcome);
        if (!conflictHandled) {
          if (key.kind === "ticket") {
            switch (outcome.kind) {
              case "completed":
              case "no_change":
                markDraftStatus(key.ticketId, "Synced", operationScope);
                break;
              case "conflict":
                markDraftStatus(key.ticketId, "Conflict", operationScope);
                break;
              case "commit_unknown":
              case "remote_committed":
              case "failed_before_commit":
                markDraftStatus(key.ticketId, "Failed", operationScope);
                break;
              case "queued":
                markDraftStatus(key.ticketId, "Queued", operationScope);
                break;
            }
          }
          presenter.present(outcome, {
            ticketId: key.kind === "ticket" ? key.ticketId : (key.kind === "comment" ? key.ticketId : undefined),
            commentId: key.kind === "comment" ? key.commentId : undefined,
            isAuto: true,
          });
        }
        if (key.kind === "newTicket" && outcome.kind === "completed") {
          try {
            if (createdTicketId !== undefined && ticketsPresentation.revealCreatedTickets) {
              await ticketsPresentation.revealCreatedTickets([createdTicketId], operationScope);
            } else {
              ticketsPresentation.refresh();
            }
          } catch {
          }
        }
        if (
          key.kind === "comment" &&
          createdCommentId !== undefined &&
          commentsPresentation.revealCreatedComment
        ) {
          try {
            await commentsPresentation.revealCreatedComment(
              key.ticketId,
              createdCommentId,
              operationScope,
            );
          } catch {
          }
        }
      } catch (error) {
        if (key.kind === "ticket") {
          markDraftStatus(key.ticketId, "Failed", operationScope);
        }
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
};
