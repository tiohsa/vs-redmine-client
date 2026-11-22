import * as vscode from "vscode";
import { saveCommentDocumentLocally } from "../views/commentSaveSync";
import type { NotificationController } from "./notificationController";
import type { SyncEngineKey } from "./syncEngine";
import type { CommentSaveResult } from "../views/commentSaveTypes";

export interface LocalCommentSaveDependencies {
  notifications: Pick<NotificationController, "notifyCommentSaveResult">;
  refreshComments: (ticketId: number) => void;
  refreshUnsynced: () => void;
  syncIfAuto: (key: SyncEngineKey) => Promise<void>;
  operationScope: string;
}

export async function saveLocalCommentDocument(
  document: vscode.TextDocument,
  ticketId: number,
  commentId: number | undefined,
  deps: LocalCommentSaveDependencies,
): Promise<CommentSaveResult> {
  const result = await saveCommentDocumentLocally({
    ticketId,
    commentId,
    content: document.getText(),
    documentUri: document.uri,
    operationScope: deps.operationScope,
  });
  deps.notifications.notifyCommentSaveResult(result);
  deps.refreshComments(ticketId);
  if (result.status === "queued") {
    await deps.syncIfAuto({
      kind: "comment",
      ticketId,
      ...(commentId === undefined ? {} : { commentId }),
      documentUri: document.uri.toString(),
    });
  } else {
    deps.refreshUnsynced();
  }
  return result;
}
