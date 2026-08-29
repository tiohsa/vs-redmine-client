import * as vscode from "vscode";
import { ConflictContext, TicketSaveResult } from "./ticketSaveTypes";
import { reloadTicketEditor } from "./ticketSaveSync";
import {
    createTicketSyncService,
    ticketSyncOutcomeToSaveResult,
} from "../app/ticketSync";
import { createSyncEngine, type SyncEngine } from "../app/syncEngine";
import {
    getTicketDraft,
    markDraftStatus,
    updateDraftAfterSave,
} from "./ticketDraftStore";
import {
    rebaseOfflineTicketUpdateAfterConflictAsync,
    rebaseOfflineCommentUpdateAfterConflictAsync,
    getOfflineSyncQueue,
    removeOfflineCommentEntryIfMatchesAsync,
    removeOfflineTicketUpdateIfMatchesAsync,
    type OfflineTicketUpdate,
    type OfflineTicketConflictExpectation,
    type OfflineCommentConflictExpectation,
} from "./offlineSyncStore";
import { registerConflictContext } from "./conflictDiffProvider";
import { buildTicketEditorContent, parseTicketEditorContent } from "./ticketEditorContent";
import { mergeThreeWay } from "../utils/threeWayMerge";
import { computeNotesHash } from "../utils/notesHash";

export type ConflictResolution = "local" | "remote" | "merge" | "cancel";

export interface ConflictResolverDeps {
    showConflictDialog: typeof showConflictDialog;
    applyRemoteContent: typeof applyRemoteContent;
    forceSaveLocal: typeof forceSaveLocal;
    mergeTicketContent: typeof mergeTicketContent;
}

const defaultDeps: ConflictResolverDeps = {
    showConflictDialog,
    applyRemoteContent,
    forceSaveLocal,
    mergeTicketContent,
};

const ticketConflictExpectation = (
    ticketId: number,
    operationScope?: string,
): OfflineTicketConflictExpectation | undefined => {
    const queued = getOfflineSyncQueue(operationScope).tickets.get(ticketId);
    return queued ? {
        operationId: queued.operationId,
        revision: queued.revision,
        intentRevision: queued.intentRevision,
        connectionScope: queued.connectionScope,
        content: queued.content,
    } : undefined;
};

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

/**
 * Show a dialog asking the user how to resolve the conflict.
 */
export async function showConflictDialog(
    context: ConflictContext,
): Promise<ConflictResolution> {
    const localLabel = vscode.l10n.t("Local Priority");
    const remoteLabel = vscode.l10n.t("Remote Priority");
    const mergeLabel = vscode.l10n.t("Merge Changes");

    const result = await vscode.window.showWarningMessage(
        vscode.l10n.t("Conflict detected in ticket #{0}. Remote has been updated.", context.ticketId),
        { modal: true },
        localLabel,
        remoteLabel,
        mergeLabel,
    );

    switch (result) {
        case localLabel:
            return "local";
        case remoteLabel:
            return "remote";
        case mergeLabel:
            return "merge";
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
        `Redmine #${context.ticketId}: Remote ↔ Local`,
    );
}

/**
 * Apply the remote content to the editor, discarding local changes.
 */
export async function applyRemoteContent(
    context: ConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    expectedOperation?: OfflineTicketConflictExpectation,
): Promise<TicketSaveResult> {
    const removalExpectation = expectedOperation ??
        ticketConflictExpectation(context.ticketId, operationScope);
    const result = await reloadTicketEditor({
        ticketId: context.ticketId,
        editor,
        operationScope,
    });
    if (result.status === "success") {
        // The queued local snapshot was the source of this conflict. It must not
        // be retried after the editor has been replaced with the remote state.
        const removed = await removeOfflineTicketUpdateIfMatchesAsync(
            context.ticketId,
            removalExpectation,
            operationScope,
        );
        if (!removed) {
            return {
                status: "conflict",
                message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
                conflictContext: context,
            };
        }
    }
    return result;
}

/**
 * Force save the local content, ignoring the conflict.
 * This updates the lastKnownRemoteUpdatedAt to the current remote value.
 */
export async function forceSaveLocal(
    context: ConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    syncPort:
        | Pick<ReturnType<typeof createTicketSyncService>, "syncEditor">
        | Pick<SyncEngine, "syncOne"> = createSyncEngine(),
    expectedOperation?: Pick<
        OfflineTicketUpdate,
        "operationId" | "revision" | "intentRevision" | "connectionScope" | "content"
    >,
): Promise<TicketSaveResult> {
    const removalExpectation = expectedOperation ??
        ticketConflictExpectation(context.ticketId, operationScope);
    const draft = getTicketDraft(context.ticketId, operationScope);
    if (!draft) {
        return { status: "failed", message: "Missing draft state for ticket." };
    }

    if (operationScope === undefined) {
        return { status: "failed", message: "Connection scope is required." };
    }
    // Advance the queued intent atomically instead of deleting it. This keeps
    // the revision fence monotonic and leaves a retryable queue entry if the
    // following sync fails before the remote write.
    const rebased = await rebaseOfflineTicketUpdateAfterConflictAsync(
        context.ticketId,
        {
            baseSubject: context.remoteSubject,
            baseDescription: context.remoteDescription,
            baseMetadata: context.remoteMetadata,
            lastKnownRemoteUpdatedAt: context.remoteUpdatedAt,
        },
        operationScope,
        removalExpectation,
    );
    if (!rebased) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    updateDraftAfterSave(
        context.ticketId,
        context.remoteSubject,
        context.remoteDescription,
        context.remoteMetadata,
        context.remoteUpdatedAt,
        operationScope,
    );
    markDraftStatus(context.ticketId, "Dirty", operationScope);
    const outcome = "syncOne" in syncPort
        ? await syncPort.syncOne(
            { kind: "ticket", ticketId: context.ticketId },
            { connectionScope: operationScope },
        )
        : await syncPort.syncEditor({
            context: { connectionScope: operationScope },
            editor,
            ticketId: context.ticketId,
            newTicket: false,
            manual: false,
        });
    return ticketSyncOutcomeToSaveResult(outcome, false);
}

export async function mergeTicketContent(
    context: ConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    expectedOperation?: OfflineTicketConflictExpectation,
): Promise<TicketSaveResult> {
    const removalExpectation = expectedOperation ??
        ticketConflictExpectation(context.ticketId, operationScope);
    const draft = getTicketDraft(context.ticketId, operationScope);
    if (!draft) {
        return { status: "failed", message: "Missing draft state for ticket." };
    }
    let current;
    try {
        current = parseTicketEditorContent(editor.document.getText(), {
            allowMissingMetadata: true,
            fallbackMetadata: draft.baseMetadata,
        });
    } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : "Invalid ticket content." };
    }
    const subject = mergeThreeWay(context.baseSubject, context.localSubject, context.remoteSubject);
    const description = mergeThreeWay(
        context.baseDescription,
        context.localDescription,
        context.remoteDescription,
    );
    await applyEditorContent(editor, buildTicketEditorContent({
        subject: subject.content,
        description: description.content,
        // Text is merged manually; metadata is taken from the latest server state.
        // Metadata itself is not safe to automatically combine field-by-field.
        metadata: context.remoteMetadata,
        layout: current.layout,
        metadataBlock: current.metadataBlock,
        controlFields: current.controlFields,
    }));
    // A queued update still carries the pre-merge remote timestamp. Keeping it
    // would cause Sync All / dashboard sync to raise the same conflict again.
    // The user must review the editor and save, which queues a new snapshot.
    const removed = await removeOfflineTicketUpdateIfMatchesAsync(
        context.ticketId,
        removalExpectation,
        operationScope,
    );
    if (!removed) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    updateDraftAfterSave(
        context.ticketId,
        context.remoteSubject,
        context.remoteDescription,
        context.remoteMetadata,
        context.remoteUpdatedAt,
        operationScope,
    );
    markDraftStatus(context.ticketId, "Dirty", operationScope);
    return {
        status: "merged",
        message: subject.hasConflicts || description.hasConflicts
            ? vscode.l10n.t("Merge conflicts were inserted. Resolve all markers before syncing.")
            : vscode.l10n.t("Merged remote and local changes. Review and save to sync."),
    };
}

/**
 * Handle a conflict result from syncTicketDraft.
 * Shows dialog and executes the user's chosen resolution.
 */
export async function handleConflict(
    result: TicketSaveResult,
    editor: vscode.TextEditor,
    deps: ConflictResolverDeps = defaultDeps,
    operationScope?: string,
    syncEngine: Pick<SyncEngine, "syncOne"> = createSyncEngine(),
): Promise<TicketSaveResult> {
    if (result.status !== "conflict" || !result.conflictContext) {
        return result;
    }

    const context = result.conflictContext;
    const queuedAtDialogOpen = operationScope === undefined
        ? undefined
        : getOfflineSyncQueue(operationScope).tickets.get(context.ticketId);
    const expectedOperation = queuedAtDialogOpen
        ? {
            operationId: queuedAtDialogOpen.operationId,
            revision: queuedAtDialogOpen.revision,
            intentRevision: queuedAtDialogOpen.intentRevision,
            connectionScope: queuedAtDialogOpen.connectionScope,
            content: queuedAtDialogOpen.content,
        }
        : undefined;
    const resolution = await deps.showConflictDialog(context);
    if (expectedOperation && operationScope !== undefined) {
        const current = getOfflineSyncQueue(operationScope).tickets.get(context.ticketId);
        if (
            !current ||
            current.operationId !== expectedOperation.operationId ||
            current.revision !== expectedOperation.revision ||
            current.content !== expectedOperation.content
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
            return deps.forceSaveLocal(
                context,
                editor,
                operationScope,
                syncEngine,
                expectedOperation,
            );

        case "remote":
            return deps.applyRemoteContent(context, editor, operationScope, expectedOperation);

        case "merge":
            return deps.mergeTicketContent(context, editor, operationScope, expectedOperation);

        case "cancel":
        default:
            return {
                status: "conflict",
                message: vscode.l10n.t("Conflict resolution was cancelled."),
                conflictContext: context,
            };
    }
}

// ============================================================================
// Comment Conflict Resolution
// ============================================================================

import { CommentConflictContext, CommentSaveResult } from "./commentSaveTypes";
import { reloadCommentEditor } from "./commentSaveSync";
import { getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { registerCommentConflictContext } from "./conflictDiffProvider";
import { applyEditorContent } from "./ticketPreview";
import { commentSyncOutcomeMessage } from "../app/commentSyncService";

/**
 * Show a dialog asking the user how to resolve a comment conflict.
 */
export async function showCommentConflictDialog(
    context: CommentConflictContext,
): Promise<ConflictResolution> {
    const localLabel = vscode.l10n.t("Local Priority");
    const remoteLabel = vscode.l10n.t("Remote Priority");
    const mergeLabel = vscode.l10n.t("Merge Changes");

    const result = context.baseBodyKnown === false
        ? await vscode.window.showWarningMessage(
            vscode.l10n.t("Conflict detected in comment #{0}. Remote has been updated.", context.commentId),
            { modal: true },
            localLabel,
            remoteLabel,
        )
        : await vscode.window.showWarningMessage(
            vscode.l10n.t("Conflict detected in comment #{0}. Remote has been updated.", context.commentId),
            { modal: true },
            localLabel,
            remoteLabel,
            mergeLabel,
        );

    switch (result) {
        case localLabel:
            return "local";
        case remoteLabel:
            return "remote";
        case mergeLabel:
            return "merge";
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
        `Comment #${context.commentId}: Remote ↔ Local`,
    );
}

/**
 * Apply the remote comment content to the editor, discarding local changes.
 */
export async function applyRemoteCommentContent(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    expectedOperation?: OfflineCommentConflictExpectation,
): Promise<CommentSaveResult> {
    const removalExpectation = expectedOperation ??
        commentConflictExpectation(context.commentId, operationScope);
    await applyEditorContent(editor, context.remoteBody);
    const removed = await removeOfflineCommentEntryIfMatchesAsync(
        { ticketId: context.ticketId, commentId: context.commentId },
        removalExpectation,
        operationScope,
    );
    if (!removed) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    updateCommentEdit(context.commentId, context.remoteBody, context.remoteUpdatedAt, operationScope);
    return { status: "success", message: vscode.l10n.t("Overwritten with remote content.") };
}

/**
 * Force save the local comment content, ignoring the conflict.
 */
export async function forceCommentSaveLocal(
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    operationScope?: string,
    syncEngine: Pick<SyncEngine, "syncOne"> = createSyncEngine(),
    expectedOperation?: OfflineCommentConflictExpectation,
): Promise<CommentSaveResult> {
    const edit = getCommentEdit(context.commentId, operationScope);
    if (!edit) {
        return { status: "failed", message: "Missing comment edit state." };
    }

    if (operationScope === undefined) {
        return { status: "failed", message: "Connection scope is required." };
    }
    const rebased = await rebaseOfflineCommentUpdateAfterConflictAsync(
        context.commentId,
        {
            baseBody: context.remoteBody,
            lastKnownRemoteUpdatedAt: context.remoteUpdatedAt,
            sourceNotesHash: computeNotesHash(context.remoteBody),
        },
        operationScope,
        expectedOperation,
    );
    if (!rebased) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    updateCommentEdit(
        context.commentId,
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
    await applyEditorContent(editor, merged.content);
    const removed = await removeOfflineCommentEntryIfMatchesAsync(
        { ticketId: context.ticketId, commentId: context.commentId },
        removalExpectation,
        operationScope,
    );
    if (!removed) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    updateCommentEdit(
        context.commentId,
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

/**
 * Handle a conflict result from syncCommentDraft.
 * Shows dialog and executes the user's chosen resolution.
 */
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
    const resolution = await showCommentConflictDialog(context);
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
