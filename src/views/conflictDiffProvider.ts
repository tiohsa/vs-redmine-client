import * as vscode from "vscode";
import { ConflictContext } from "./ticketSaveTypes";
import { CommentConflictContext } from "./commentSaveTypes";
import { buildTicketPreviewContent } from "./ticketPreview";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";
import type { OfflineTicketConflictExpectation } from "./offlineSyncStore";

export const CONFLICT_SCHEME = "redmine-conflict";
export const COMMENT_CONFLICT_SCHEME = "redmine-comment-conflict";

// Store for ticket conflict context, keyed by connection scope and ticketId.
const conflictContexts = new Map<string, ConflictContext>();
const conflictContextExpectations = new Map<string, OfflineTicketConflictExpectation>();

// Store for comment conflict context, keyed by connection scope and commentId.
const commentConflictContexts = new Map<string, CommentConflictContext>();

const scopedKey = (scopeHash: string, id: number): string => `${scopeHash}\u0000${id}`;
const contextScope = (scope: string | undefined): string => scope ?? getCurrentConnectionScope();
const scopeHashFromUri = (uri: vscode.Uri): string | undefined => {
    const match = uri.query.match(/(?:^|&)scope=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
};

/**
 * Register a conflict context for a ticket.
 */
export function registerConflictContext(
    context: ConflictContext,
    expectedOperation?: OfflineTicketConflictExpectation,
): void {
    const key = scopedKey(getConnectionScopeHash(contextScope(context.connectionScope)), context.ticketId);
    const previous = conflictContexts.get(key);
    conflictContexts.set(key, context);
    if (expectedOperation) {
        conflictContextExpectations.set(key, structuredClone(expectedOperation));
    } else if (previous !== context) {
        conflictContextExpectations.delete(key);
    }
}

/**
 * Get a conflict context for a ticket.
 */
export function getConflictContext(
    ticketId: number,
    scope = getCurrentConnectionScope(),
): ConflictContext | undefined {
    return conflictContexts.get(scopedKey(getConnectionScopeHash(scope), ticketId));
}

/**
 * Clear a conflict context for a ticket.
 */
export function getConflictContextExpectation(
    ticketId: number,
    scope = getCurrentConnectionScope(),
): OfflineTicketConflictExpectation | undefined {
    const expectation = conflictContextExpectations.get(scopedKey(getConnectionScopeHash(scope), ticketId));
    return expectation ? structuredClone(expectation) : undefined;
}

export function clearConflictContext(ticketId: number, scope = getCurrentConnectionScope()): void {
    const key = scopedKey(getConnectionScopeHash(scope), ticketId);
    conflictContexts.delete(key);
    conflictContextExpectations.delete(key);
}

/**
 * Register a conflict context for a comment.
 */
export function registerCommentConflictContext(context: CommentConflictContext): void {
    commentConflictContexts.set(
        scopedKey(getConnectionScopeHash(contextScope(context.connectionScope)), context.commentId),
        context,
    );
}

/**
 * Get a conflict context for a comment.
 */
export function getCommentConflictContext(
    commentId: number,
    scope = getCurrentConnectionScope(),
): CommentConflictContext | undefined {
    return commentConflictContexts.get(scopedKey(getConnectionScopeHash(scope), commentId));
}

/**
 * Clear a conflict context for a comment.
 */
export function clearCommentConflictContext(commentId: number, scope = getCurrentConnectionScope()): void {
    commentConflictContexts.delete(scopedKey(getConnectionScopeHash(scope), commentId));
}

/**
 * TextDocumentContentProvider for displaying remote ticket content in diff view.
 */
export class ConflictDiffProvider implements vscode.TextDocumentContentProvider {
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        // URI format: redmine-conflict:/{ticketId}/remote.md?ts={timestamp}
        const match = uri.path.match(/^\/(\d+)\/remote\.md$/);
        if (!match) {
            return "// Invalid conflict URI";
        }

        const ticketId = parseInt(match[1], 10);
        const scopeHash = scopeHashFromUri(uri);
        const context = scopeHash
            ? conflictContexts.get(scopedKey(scopeHash, ticketId))
            : getConflictContext(ticketId);

        if (!context) {
            return "// Conflict context not found. Please try saving again.";
        }

        const metadata = context.remoteMetadata;

        // Build content in the same format as the ticket editor
        return buildTicketPreviewContent({
            subject: context.remoteSubject,
            description: context.remoteDescription,
            trackerName: metadata.tracker,
            priorityName: metadata.priority,
            statusName: metadata.status,
            dueDate: metadata.due_date,
        });
    }

    refresh(ticketId: number): void {
        const scopeHash = getConnectionScopeHash(getCurrentConnectionScope());
        const uri = vscode.Uri.parse(`${CONFLICT_SCHEME}:/${ticketId}/remote.md?scope=${scopeHash}`);
        this.onDidChangeEmitter.fire(uri);
    }

    dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

/**
 * TextDocumentContentProvider for displaying remote comment content in diff view.
 */
export class CommentConflictDiffProvider implements vscode.TextDocumentContentProvider {
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        // URI format: redmine-comment-conflict:/{commentId}/remote.md?ts={timestamp}
        const match = uri.path.match(/^\/(\d+)\/remote\.md$/);
        if (!match) {
            return "// Invalid comment conflict URI";
        }

        const commentId = parseInt(match[1], 10);
        const scopeHash = scopeHashFromUri(uri);
        const context = scopeHash
            ? commentConflictContexts.get(scopedKey(scopeHash, commentId))
            : getCommentConflictContext(commentId);

        if (!context) {
            return "// Comment conflict context not found. Please try saving again.";
        }

        // Return raw comment body
        return context.remoteBody;
    }

    refresh(commentId: number): void {
        const scopeHash = getConnectionScopeHash(getCurrentConnectionScope());
        const uri = vscode.Uri.parse(`${COMMENT_CONFLICT_SCHEME}:/${commentId}/remote.md?scope=${scopeHash}`);
        this.onDidChangeEmitter.fire(uri);
    }

    dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

let providerInstance: ConflictDiffProvider | undefined;
let commentProviderInstance: CommentConflictDiffProvider | undefined;

/**
 * Register the conflict diff providers with VS Code.
 */
export function registerConflictDiffProvider(
    context: vscode.ExtensionContext,
): ConflictDiffProvider {
    if (!providerInstance) {
        providerInstance = new ConflictDiffProvider();
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(
                CONFLICT_SCHEME,
                providerInstance,
            ),
        );
    }

    if (!commentProviderInstance) {
        commentProviderInstance = new CommentConflictDiffProvider();
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(
                COMMENT_CONFLICT_SCHEME,
                commentProviderInstance,
            ),
        );
    }

    return providerInstance;
}

/**
 * Get the registered conflict diff provider instance.
 */
export function getConflictDiffProvider(): ConflictDiffProvider | undefined {
    return providerInstance;
}
