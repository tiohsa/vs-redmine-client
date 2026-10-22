import * as vscode from "vscode";
import { ConflictContext, TicketSaveResult } from "./ticketSaveTypes";
import type { TicketReloadDependencies } from "./ticketSaveSync";
import { getIssueDetail } from "../redmine/issues";
import { metadataFromTicket } from "./ticketSync/ticketRemoteContent";
import { mapErrorToResult } from "./ticketSync/ticketSyncResult";
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
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";
import { getAttemptGeneration } from "../app/syncEffects";

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

/** キューの確定に失敗した場合、自分が適用した編集だけを取り消す。 */
const applyConflictEditorContent = async (
    editor: vscode.TextEditor,
    content: string,
    removeQueueEntry: () => Promise<boolean>,
): Promise<boolean> => {
    const previousContent = editor.document.getText();
    await applyEditorContent(editor, content);
    const appliedContent = editor.document.getText();
    // VS Code は文書の EOL に合わせて編集を正規化する。
    if (appliedContent.replace(/\r\n/g, "\n") !== content.replace(/\r\n/g, "\n")) { return false; }
    const appliedVersion = editor.document.version;
    const restore = async (): Promise<void> => {
        // 永続化待機中のユーザー編集や別の解決処理を上書きしない。
        if (editor.document.version === appliedVersion && editor.document.getText() === appliedContent) {
            await applyEditorContent(editor, previousContent);
        }
    };
    let removed: boolean;
    try {
        removed = await removeQueueEntry();
    } catch (error) {
        await restore();
        throw error;
    }
    if (!removed) { await restore(); }
    return removed;
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

    const scopeHash = getConnectionScopeHash(context.connectionScope ?? getCurrentConnectionScope());
    const remoteUri = vscode.Uri.parse(
        `redmine-conflict:/${context.ticketId}/remote.md?scope=${scopeHash}&ts=${Date.now()}`,
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
    deps: Pick<TicketReloadDependencies, "getIssueDetail"> = { getIssueDetail },
): Promise<TicketSaveResult> {
    const removalExpectation = expectedOperation ??
        ticketConflictExpectation(context.ticketId, operationScope);
    const previousContent = editor.document.getText();
    const previousVersion = editor.document.version;
    try {
        if (removalExpectation && previousContent !== removalExpectation.content) {
            return {
                status: "conflict",
                message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
                conflictContext: context,
            };
        }
        const detail = await deps.getIssueDetail(context.ticketId);
        if (editor.document.version !== previousVersion || editor.document.getText() !== previousContent) {
            return {
                status: "conflict",
                message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
                conflictContext: context,
            };
        }
        const removed = await applyConflictEditorContent(
            editor,
            buildTicketPreviewContent(detail.ticket),
            () => removeOfflineTicketUpdateIfMatchesAsync(
                context.ticketId,
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
        updateDraftAfterSave(
            context.ticketId,
            detail.ticket.subject,
            detail.ticket.description ?? "",
            metadataFromTicket(detail.ticket),
            detail.ticket.updatedAt,
            operationScope,
        );
        return { status: "success", message: vscode.l10n.t("Reloaded from Redmine.") };
    } catch (error) {
        return mapErrorToResult(error);
    }
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
    if (removalExpectation && editor.document.getText() !== removalExpectation.content) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    const subject = mergeThreeWay(context.baseSubject, context.localSubject, context.remoteSubject);
    const description = mergeThreeWay(
        context.baseDescription,
        context.localDescription,
        context.remoteDescription,
    );
    const removed = await applyConflictEditorContent(editor, buildTicketEditorContent({
        subject: subject.content,
        description: description.content,
        // Text is merged manually; metadata is taken from the latest server state.
        // Metadata itself is not safe to automatically combine field-by-field.
        metadata: context.remoteMetadata,
        layout: current.layout,
        metadataBlock: current.metadataBlock,
        controlFields: current.controlFields,
    }), () => removeOfflineTicketUpdateIfMatchesAsync(
        context.ticketId,
        removalExpectation,
        operationScope,
    ));
    // A queued update still carries the pre-merge remote timestamp. Keeping it
    // would cause Sync All / dashboard sync to raise the same conflict again.
    // The user must review the editor and save, which queues a new snapshot.
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
    expectedConflictOperation?: OfflineTicketConflictExpectation,
): Promise<TicketSaveResult> {
    if (result.status !== "conflict" || !result.conflictContext) {
        return result;
    }

    const context = result.conflictContext;
    const queuedAtDialogOpen = operationScope === undefined
        ? undefined
        : getOfflineSyncQueue(operationScope).tickets.get(context.ticketId);
    if (expectedConflictOperation && (
        !queuedAtDialogOpen ||
        queuedAtDialogOpen.operationId !== expectedConflictOperation.operationId ||
        queuedAtDialogOpen.revision !== expectedConflictOperation.revision ||
        (expectedConflictOperation.intentRevision !== undefined &&
            (queuedAtDialogOpen.intentRevision ?? queuedAtDialogOpen.revision) !== expectedConflictOperation.intentRevision) ||
        (expectedConflictOperation.attemptGeneration !== undefined &&
            getAttemptGeneration(queuedAtDialogOpen) !== expectedConflictOperation.attemptGeneration) ||
        (expectedConflictOperation.connectionScope !== undefined &&
            queuedAtDialogOpen.connectionScope !== expectedConflictOperation.connectionScope) ||
        queuedAtDialogOpen.content !== expectedConflictOperation.content
    )) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    const expectedOperation = queuedAtDialogOpen
        ? {
            operationId: queuedAtDialogOpen.operationId,
            revision: queuedAtDialogOpen.revision,
            intentRevision: queuedAtDialogOpen.intentRevision,
            attemptGeneration: getAttemptGeneration(queuedAtDialogOpen),
            connectionScope: queuedAtDialogOpen.connectionScope,
            content: queuedAtDialogOpen.content,
        }
        : undefined;
    registerConflictContext(context, expectedOperation);
    const dialogContent = editor.document.getText();
    const dialogVersion = editor.document.version;
    const resolution = await deps.showConflictDialog(context);
    if (editor.document.version !== dialogVersion || editor.document.getText() !== dialogContent) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    if (expectedOperation && operationScope !== undefined) {
        const current = getOfflineSyncQueue(operationScope).tickets.get(context.ticketId);
        if (
            !current ||
            current.operationId !== expectedOperation.operationId ||
            current.revision !== expectedOperation.revision ||
            (expectedOperation.intentRevision !== undefined &&
                (current.intentRevision ?? current.revision) !== expectedOperation.intentRevision) ||
            (expectedOperation.attemptGeneration !== undefined &&
                getAttemptGeneration(current) !== expectedOperation.attemptGeneration) ||
            (expectedOperation.connectionScope !== undefined &&
                current.connectionScope !== expectedOperation.connectionScope) ||
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
import { ensureCommentEdit } from "./commentEditStore";
import { registerCommentConflictContext } from "./conflictDiffProvider";
import { applyEditorContent, buildTicketPreviewContent } from "./ticketPreview";
import { commentSyncOutcomeMessage } from "../app/commentSyncService";
import {
    buildCommentUpdateFileContent,
    invalidCommentUpdateMetadataMessage,
    isCommentUpdateDocument,
    parseCommentUpdateFile,
} from "./commentUpdateFile";

const resolvedCommentEditorContent = (
    context: CommentConflictContext,
    editor: vscode.TextEditor,
    body: string,
    expectedBody?: string,
): { ok: true; content: string; hasMetadata: boolean } | { ok: false; result: CommentSaveResult } => {
    const current = editor.document.getText();
    const parsed = parseCommentUpdateFile(current);
    if (
        (!parsed && isCommentUpdateDocument(current, editor.document.uri.path)) ||
        (parsed && (parsed.fields.issueId !== context.ticketId ||
            parsed.fields.journalId !== context.commentId))
    ) {
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

    const scopeHash = getConnectionScopeHash(context.connectionScope ?? getCurrentConnectionScope());
    const remoteUri = vscode.Uri.parse(
        `redmine-comment-conflict:/${context.commentId}/remote.md?scope=${scopeHash}&ts=${Date.now()}`,
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
    const dialogContent = editor.document.getText();
    const dialogVersion = editor.document.version;
    const resolution = await showCommentConflictDialog(context);
    if (editor.document.version !== dialogVersion || editor.document.getText() !== dialogContent) {
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
