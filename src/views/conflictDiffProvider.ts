import * as vscode from "vscode";
import { ConflictContext } from "./ticketSaveTypes";
import { CommentConflictContext } from "./commentSaveTypes";
import { buildTicketPreviewContent } from "./ticketPreview";
import { getTicketDraft } from "./ticketDraftStore";

export const CONFLICT_SCHEME = "redmine-conflict";
export const COMMENT_CONFLICT_SCHEME = "redmine-comment-conflict";

// Store for ticket conflict context, keyed by ticketId.
const conflictContexts = new Map<number, ConflictContext>();

// Store for comment conflict context, keyed by commentId.
const commentConflictContexts = new Map<number, CommentConflictContext>();

/**
 * Register a conflict context for a ticket.
 */
export function registerConflictContext(context: ConflictContext): void {
    conflictContexts.set(context.ticketId, context);
}

/**
 * Get a conflict context for a ticket.
 */
export function getConflictContext(ticketId: number): ConflictContext | undefined {
    return conflictContexts.get(ticketId);
}

/**
 * Clear a conflict context for a ticket.
 */
export function clearConflictContext(ticketId: number): void {
    conflictContexts.delete(ticketId);
}

/**
 * Register a conflict context for a comment.
 */
export function registerCommentConflictContext(context: CommentConflictContext): void {
    commentConflictContexts.set(context.commentId, context);
}

/**
 * Get a conflict context for a comment.
 */
export function getCommentConflictContext(commentId: number): CommentConflictContext | undefined {
    return commentConflictContexts.get(commentId);
}

/**
 * Clear a conflict context for a comment.
 */
export function clearCommentConflictContext(commentId: number): void {
    commentConflictContexts.delete(commentId);
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
        const context = getConflictContext(ticketId);

        if (!context) {
            return "// Conflict context not found. Please try saving again.";
        }

        // Get draft metadata for formatting
        const draft = getTicketDraft(ticketId);
        const metadata = draft?.baseMetadata ?? {
            tracker: "",
            priority: "",
            status: "",
            due_date: "",
        };

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
        const uri = vscode.Uri.parse(`${CONFLICT_SCHEME}:/${ticketId}/remote.md`);
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
        const context = getCommentConflictContext(commentId);

        if (!context) {
            return "// Comment conflict context not found. Please try saving again.";
        }

        // Return raw comment body
        return context.remoteBody;
    }

    refresh(commentId: number): void {
        const uri = vscode.Uri.parse(`${COMMENT_CONFLICT_SCHEME}:/${commentId}/remote.md`);
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

