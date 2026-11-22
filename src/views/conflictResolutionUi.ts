import * as vscode from "vscode";
import { ConflictContext } from "./ticketSaveTypes";
import { registerConflictContext } from "./conflictDiffProvider";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";

import { CommentConflictContext } from "./commentSaveTypes";
import { registerCommentConflictContext } from "./conflictDiffProvider";

export type ConflictResolution = "local" | "remote" | "merge" | "cancel";

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

export async function openDiffEditor(
    context: ConflictContext,
    editor: vscode.TextEditor,
): Promise<void> {

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

