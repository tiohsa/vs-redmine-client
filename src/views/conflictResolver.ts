import * as vscode from "vscode";
import { ConflictContext, TicketSaveResult } from "./ticketSaveTypes";
import { reloadTicketEditor, syncTicketDraft } from "./ticketSaveSync";
import {
    getTicketDraft,
    markDraftStatus,
    updateDraftAfterSave,
} from "./ticketDraftStore";
import { registerConflictContext } from "./conflictDiffProvider";

export type ConflictResolution = "local" | "remote" | "diff" | "cancel";

export interface ConflictResolverDeps {
    showConflictDialog: typeof showConflictDialog;
    openDiffEditor: typeof openDiffEditor;
    applyRemoteContent: typeof applyRemoteContent;
    forceSaveLocal: typeof forceSaveLocal;
}

const defaultDeps: ConflictResolverDeps = {
    showConflictDialog,
    openDiffEditor,
    applyRemoteContent,
    forceSaveLocal,
};

/**
 * Show a dialog asking the user how to resolve the conflict.
 */
export async function showConflictDialog(
    context: ConflictContext,
): Promise<ConflictResolution> {
    const localLabel = "ローカル優先";
    const remoteLabel = "リモート優先";
    const diffLabel = "差分を確認";
    const cancelLabel = "キャンセル";

    const result = await vscode.window.showWarningMessage(
        `チケット #${context.ticketId} に競合が検出されました。リモートで更新があります。`,
        { modal: true },
        localLabel,
        remoteLabel,
        diffLabel,
    );

    switch (result) {
        case localLabel:
            return "local";
        case remoteLabel:
            return "remote";
        case diffLabel:
            return "diff";
        default:
            return "cancel";
    }
}

/**
 * Open a diff editor comparing remote (left, read-only) and local (right, editable).
 * Returns when the user closes the diff editor.
 */
export async function openDiffEditor(
    context: ConflictContext,
    editor: vscode.TextEditor,
): Promise<void> {
    // Register the conflict context so the diff provider can access it.
    registerConflictContext(context);

    const remoteUri = vscode.Uri.parse(
        `redmine-conflict:/${context.ticketId}/remote.md?ts=${Date.now()}`,
    );

    const localUri = editor.document.uri;

    await vscode.commands.executeCommand(
        "vscode.diff",
        remoteUri,
        localUri,
        `Redmine #${context.ticketId}: リモート ↔ ローカル`,
    );
}

/**
 * Apply the remote content to the editor, discarding local changes.
 */
export async function applyRemoteContent(
    context: ConflictContext,
    editor: vscode.TextEditor,
): Promise<TicketSaveResult> {
    return reloadTicketEditor({
        ticketId: context.ticketId,
        editor,
    });
}

/**
 * Force save the local content, ignoring the conflict.
 * This updates the lastKnownRemoteUpdatedAt to the current remote value.
 */
export async function forceSaveLocal(
    context: ConflictContext,
    editor: vscode.TextEditor,
): Promise<TicketSaveResult> {
    const draft = getTicketDraft(context.ticketId);
    if (!draft) {
        return { status: "failed", message: "Missing draft state for ticket." };
    }

    // Temporarily update the lastKnownRemoteUpdatedAt to bypass conflict detection.
    updateDraftAfterSave(
        context.ticketId,
        draft.baseSubject,
        draft.baseDescription,
        draft.baseMetadata,
        context.remoteUpdatedAt,
    );
    markDraftStatus(context.ticketId, "dirty");

    // Now sync again with the updated timestamp.
    const result = await syncTicketDraft({
        ticketId: context.ticketId,
        content: editor.document.getText(),
        editor,
    });

    return result;
}

/**
 * Handle a conflict result from syncTicketDraft.
 * Shows dialog and executes the user's chosen resolution.
 */
export async function handleConflict(
    result: TicketSaveResult,
    editor: vscode.TextEditor,
    deps: ConflictResolverDeps = defaultDeps,
): Promise<TicketSaveResult> {
    if (result.status !== "conflict" || !result.conflictContext) {
        return result;
    }

    const context = result.conflictContext;
    const resolution = await deps.showConflictDialog(context);

    switch (resolution) {
        case "local":
            return deps.forceSaveLocal(context, editor);

        case "remote":
            return deps.applyRemoteContent(context, editor);

        case "diff":
            await deps.openDiffEditor(context, editor);
            // After opening diff, user needs to manually save again.
            return {
                status: "conflict",
                message: "差分エディタを開きました。編集後に再度保存してください。",
                conflictContext: context,
            };

        case "cancel":
        default:
            return {
                status: "conflict",
                message: "競合解決がキャンセルされました。",
                conflictContext: context,
            };
    }
}

// ============================================================================
// Comment Conflict Resolution
// ============================================================================

import { CommentConflictContext, CommentSaveResult } from "./commentSaveTypes";
import { reloadCommentEditor, syncCommentDraft } from "./commentSaveSync";
import { getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { registerCommentConflictContext } from "./conflictDiffProvider";
import { applyEditorContent } from "./ticketPreview";

/**
 * Show a dialog asking the user how to resolve a comment conflict.
 */
export async function showCommentConflictDialog(
    context: CommentConflictContext,
): Promise<ConflictResolution> {
    const localLabel = "ローカル優先";
    const remoteLabel = "リモート優先";
    const diffLabel = "差分を確認";

    const result = await vscode.window.showWarningMessage(
        `コメント #${context.commentId} に競合が検出されました。リモートで更新があります。`,
        { modal: true },
        localLabel,
        remoteLabel,
        diffLabel,
    );

    switch (result) {
        case localLabel:
            return "local";
        case remoteLabel:
            return "remote";
        case diffLabel:
            return "diff";
        default:
            return "cancel";
    }
}

/**
 * Open a diff editor comparing remote (left, read-only) and local (right, editable) comment.
 */
export async function openCommentDiffEditor(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
): Promise<void> {
    registerCommentConflictContext(context);

    const remoteUri = vscode.Uri.parse(
        `redmine-comment-conflict:/${context.commentId}/remote.md?ts=${Date.now()}`,
    );

    const localUri = editor.document.uri;

    await vscode.commands.executeCommand(
        "vscode.diff",
        remoteUri,
        localUri,
        `コメント #${context.commentId}: リモート ↔ ローカル`,
    );
}

/**
 * Apply the remote comment content to the editor, discarding local changes.
 */
export async function applyRemoteCommentContent(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
): Promise<CommentSaveResult> {
    await applyEditorContent(editor, context.remoteBody);
    updateCommentEdit(context.commentId, context.remoteBody);
    return { status: "success", message: "リモート内容で上書きしました。" };
}

/**
 * Force save the local comment content, ignoring the conflict.
 */
export async function forceCommentSaveLocal(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
): Promise<CommentSaveResult> {
    const edit = getCommentEdit(context.commentId);
    if (!edit) {
        return { status: "failed", message: "Missing comment edit state." };
    }

    // Update the base to remote so next save won't detect conflict
    updateCommentEdit(context.commentId, context.remoteBody, context.remoteUpdatedAt);

    // Now sync again
    const result = await syncCommentDraft({
        commentId: context.commentId,
        content: editor.document.getText(),
        editor,
    });

    return result;
}

/**
 * Handle a conflict result from syncCommentDraft.
 * Shows dialog and executes the user's chosen resolution.
 */
export async function handleCommentConflict(
    result: CommentSaveResult,
    editor: vscode.TextEditor,
): Promise<CommentSaveResult> {
    if (result.status !== "conflict" || !result.conflictContext) {
        return result;
    }

    const context = result.conflictContext;
    const resolution = await showCommentConflictDialog(context);

    switch (resolution) {
        case "local":
            return forceCommentSaveLocal(context, editor);

        case "remote":
            return applyRemoteCommentContent(context, editor);

        case "diff":
            await openCommentDiffEditor(context, editor);
            return {
                status: "conflict",
                message: "差分エディタを開きました。編集後に再度保存してください。",
                conflictContext: context,
            };

        case "cancel":
        default:
            return {
                status: "conflict",
                message: "競合解決がキャンセルされました。",
                conflictContext: context,
            };
    }
}

