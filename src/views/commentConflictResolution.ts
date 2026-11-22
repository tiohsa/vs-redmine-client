import * as vscode from "vscode";
import { createSyncEngine, type SyncEngine } from "../app/syncEngine";
import {
  rebaseOfflineCommentUpdateAfterConflictAsync,
  getOfflineSyncQueue,
  removeOfflineCommentEntryIfMatchesAsync,
  type OfflineCommentConflictExpectation,
} from "./offlineSyncStore";
import { mergeThreeWay } from "../utils/threeWayMerge";
import { computeNotesHash } from "../utils/notesHash";

import { CommentConflictContext, CommentSaveResult } from "./commentSaveTypes";
import { ensureCommentEdit } from "./commentEditStore";
import { applyEditorContent } from "./ticketPreview";
import { commentSyncOutcomeMessage } from "../app/commentSyncService";
import {
  buildCommentUpdateFileContent,
  invalidCommentUpdateMetadataMessage,
  hasInvalidCommentUpdateMetadata,
  parseCommentUpdateFile,
} from "./commentUpdateFile";

import { applyConflictEditorContent, hasConflictDocumentChanged } from "./conflictResolutionEditor";
import { showCommentConflictDialog } from "./conflictResolutionUi";

const commentConflictExpectation = (
    commentId: number,
    operationScope?: string,
): OfflineCommentConflictExpectation | undefined => {
    const queued = getOfflineSyncQueue(operationScope).comments.find(
        (entry) => entry.commentId === commentId,
    );
    return queued ? {
        operationId: queued.operationId,
        revision: queued.revision,
        intentRevision: queued.intentRevision,
        connectionScope: queued.connectionScope,
        body: queued.body,
    } : undefined;
};

const resolvedCommentEditorContent = (
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    body: string,
    expectedBody?: string,
): { ok: true; content: string; hasMetadata: boolean } | { ok: false; result: CommentSaveResult } => {
    const current = editor.document.getText();
    const parsed = parseCommentUpdateFile(current);
    if (hasInvalidCommentUpdateMetadata(parsed, current, editor.document.uri.path, {
        issueId: context.ticketId,
        journalId: context.commentId,
    })) {
        return {
            ok: false,
            result: { status: "failed", message: invalidCommentUpdateMetadataMessage() },
        };
    }
    if (expectedBody !== undefined && (parsed?.body ?? current) !== expectedBody) {
        return {
            ok: false,
            result: {
                status: "conflict",
                message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
                conflictContext: context,
            },
        };
    }
    return {
        ok: true,
        hasMetadata: parsed !== undefined,
        content: parsed ? buildCommentUpdateFileContent({
            ...parsed.fields,
            sourceNotesHash: computeNotesHash(context.remoteBody),
            lastSyncedAt: new Date().toISOString(),
        }, body) : body,
    };
};

export async function applyRemoteCommentContent(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    expectedOperation?: OfflineCommentConflictExpectation,
): Promise<CommentSaveResult> {
    const removalExpectation = expectedOperation ??
        commentConflictExpectation(context.commentId, operationScope);
    const resolved = resolvedCommentEditorContent(context, editor, context.remoteBody, removalExpectation?.body);
    if (!resolved.ok) { return resolved.result; }
    const removed = await applyConflictEditorContent(
        editor,
        resolved.content,
        () => removeOfflineCommentEntryIfMatchesAsync(
            { ticketId: context.ticketId, commentId: context.commentId },
            removalExpectation,
            operationScope,
        ),
    );
    if (!removed) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    ensureCommentEdit(context.commentId, context.ticketId, context.remoteBody, context.remoteUpdatedAt, operationScope);
    return { status: "success", message: vscode.l10n.t("Overwritten with remote content.") };
}

export async function forceCommentSaveLocal(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    syncEngine: Pick<SyncEngine, "syncOne"> = createSyncEngine(),
    expectedOperation?: OfflineCommentConflictExpectation,
): Promise<CommentSaveResult> {
    if (operationScope === undefined) {
        return { status: "failed", message: "Connection scope is required." };
    }
    const resolved = resolvedCommentEditorContent(context, editor, context.localBody);
    if (!resolved.ok) { return resolved.result; }
    const queued = getOfflineSyncQueue(operationScope).comments.find(
        (entry) => entry.commentId === context.commentId,
    );
    const rebaseExpectation = expectedOperation ??
        commentConflictExpectation(context.commentId, operationScope);
    const rebased = await rebaseOfflineCommentUpdateAfterConflictAsync(
        context.commentId,
        {
            baseBody: context.remoteBody,
            lastKnownRemoteUpdatedAt: context.remoteUpdatedAt,
            ...(resolved.hasMetadata || queued?.sourceNotesHash !== undefined
                ? { sourceNotesHash: computeNotesHash(context.remoteBody) }
                : {}),
        },
        operationScope,
        rebaseExpectation,
    );
    if (!rebased) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    if (resolved.hasMetadata) {
        const current = editor.document.getText();
        const refreshed = resolvedCommentEditorContent(
            context,
            editor,
            parseCommentUpdateFile(current)?.body ?? current,
        );
        if (!refreshed.ok) { return refreshed.result; }
        await applyEditorContent(editor, refreshed.content);
    }
    ensureCommentEdit(
        context.commentId,
        context.ticketId,
        context.remoteBody,
        context.remoteUpdatedAt,
        operationScope,
    );
    const outcome = await syncEngine.syncOne(
        {
            kind: "comment",
            ticketId: rebased.ticketId,
            commentId: context.commentId,
            documentUri: rebased.documentUri ?? editor.document.uri.toString(),
        },
        { connectionScope: operationScope },
    );
    if (outcome.kind === "completed") {
        return { status: "success", message: "Comment updated." };
    }
    if (outcome.kind === "no_change") {
        return { status: "no_change", message: "No changes to save." };
    }
    return {
        status: outcome.kind === "conflict" ? "conflict" : "failed",
        message: commentSyncOutcomeMessage(outcome),
        conflictContext: outcome.kind === "conflict" &&
            "commentConflictContext" in outcome
            ? outcome.commentConflictContext
            : undefined,
    };
}

export async function mergeCommentContent(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    expectedOperation?: OfflineCommentConflictExpectation,
): Promise<CommentSaveResult> {
    const removalExpectation = expectedOperation ??
        commentConflictExpectation(context.commentId, operationScope);
    const merged = mergeThreeWay(context.baseBody, context.localBody, context.remoteBody);
    const resolved = resolvedCommentEditorContent(context, editor, merged.content, removalExpectation?.body);
    if (!resolved.ok) { return resolved.result; }
    const removed = await applyConflictEditorContent(
        editor,
        resolved.content,
        () => removeOfflineCommentEntryIfMatchesAsync(
            { ticketId: context.ticketId, commentId: context.commentId },
            removalExpectation,
            operationScope,
        ),
    );
    if (!removed) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    ensureCommentEdit(
        context.commentId,
        context.ticketId,
        context.remoteBody,
        context.remoteUpdatedAt,
        operationScope,
    );
    return {
        status: "merged",
        message: merged.hasConflicts
            ? vscode.l10n.t("Merge conflicts were inserted. Resolve all markers before syncing.")
            : vscode.l10n.t("Merged remote and local changes. Review and save to sync."),
    };
}

export async function handleCommentConflict(
    result: CommentSaveResult,
    editor: vscode.TextEditor,
    operationScope?: string,
    syncEngine: Pick<SyncEngine, "syncOne"> = createSyncEngine(),
): Promise<CommentSaveResult> {
    if (result.status !== "conflict" || !result.conflictContext) {
        return result;
    }

    const context = result.conflictContext;
    const queuedAtDialogOpen = operationScope === undefined
        ? undefined
        : getOfflineSyncQueue(operationScope).comments.find(
            (entry) => entry.commentId === context.commentId,
        );
    const expectedOperation = queuedAtDialogOpen
        ? {
            operationId: queuedAtDialogOpen.operationId,
            revision: queuedAtDialogOpen.revision,
            intentRevision: queuedAtDialogOpen.intentRevision,
            connectionScope: queuedAtDialogOpen.connectionScope,
            body: queuedAtDialogOpen.body,
        }
        : undefined;
    const dialogContent = editor.document.getText();
    const dialogVersion = editor.document.version;
    const resolution = await showCommentConflictDialog(context);
    if (hasConflictDocumentChanged(editor.document, dialogVersion, dialogContent)) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    if (expectedOperation && operationScope !== undefined) {
        const current = getOfflineSyncQueue(operationScope).comments.find(
            (entry) => entry.commentId === context.commentId,
        );
        if (
            !current ||
            current.operationId !== expectedOperation.operationId ||
            current.revision !== expectedOperation.revision ||
            current.body !== expectedOperation.body
        ) {
            return {
                status: "conflict",
                message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
                conflictContext: context,
            };
        }
    }

    switch (resolution) {
        case "local":
            return forceCommentSaveLocal(
                context,
                editor,
                operationScope,
                syncEngine,
                expectedOperation,
            );

        case "remote":
            return applyRemoteCommentContent(context, editor, operationScope, expectedOperation);

        case "merge":
            return mergeCommentContent(context, editor, operationScope, expectedOperation);

        case "cancel":
        default:
            return {
                status: "conflict",
                message: vscode.l10n.t("Conflict resolution was cancelled."),
                conflictContext: context,
            };
    }
}
