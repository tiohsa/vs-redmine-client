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
  getOfflineSyncQueue,
  removeOfflineTicketUpdateIfMatchesAsync,
  type OfflineTicketUpdate,
  type OfflineTicketConflictExpectation,
} from "./offlineSyncStore";
import { registerConflictContext } from "./conflictDiffProvider";
import { buildTicketEditorContent, parseTicketEditorContent } from "./ticketEditorContent";
import { mergeThreeWay } from "../utils/threeWayMerge";
import { getAttemptGeneration } from "../app/syncEffects";

import { buildTicketPreviewContent } from "./ticketPreview";

import { applyConflictEditorContent, hasConflictDocumentChanged } from "./conflictResolutionEditor";
import { showConflictDialog } from "./conflictResolutionUi";

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

export const matchesQueuedTicketConflict = (
    queued: OfflineTicketUpdate | undefined,
    expected: OfflineTicketConflictExpectation,
): boolean => queued !== undefined &&
    queued.operationId === expected.operationId &&
    queued.revision === expected.revision &&
    (expected.intentRevision === undefined ||
        (queued.intentRevision ?? queued.revision) === expected.intentRevision) &&
    (expected.attemptGeneration === undefined ||
        getAttemptGeneration(queued) === expected.attemptGeneration) &&
    (expected.connectionScope === undefined || queued.connectionScope === expected.connectionScope) &&
    queued.content === expected.content;

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
        if (hasConflictDocumentChanged(editor.document, previousVersion, previousContent)) {
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

        metadata: context.remoteMetadata,
        layout: current.layout,
        metadataBlock: current.metadataBlock,
        controlFields: current.controlFields,
    }), () => removeOfflineTicketUpdateIfMatchesAsync(
        context.ticketId,
        removalExpectation,
        operationScope,
    ));

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
    if (expectedConflictOperation && !matchesQueuedTicketConflict(queuedAtDialogOpen, expectedConflictOperation)) {
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
    if (hasConflictDocumentChanged(editor.document, dialogVersion, dialogContent)) {
        return {
            status: "conflict",
            message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
            conflictContext: context,
        };
    }
    if (expectedOperation && operationScope !== undefined) {
        const current = getOfflineSyncQueue(operationScope).tickets.get(context.ticketId);
        if (!matchesQueuedTicketConflict(current, expectedOperation)) {
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
