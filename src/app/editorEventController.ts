import * as path from "path";
import * as vscode from "vscode";
import { setCommentDraft } from "../views/commentDraftStore";
import { setCommentDraftBody } from "../views/commentEditStore";
import {
  isNewTicketDraftFilename,
  parseDirectTicketFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import { formatTicketLabel } from "../views/ticketLabel";
import { parseTicketEditorContent } from "../views/ticketEditorContent";
import { setTicketDraftContent } from "../views/ticketDraftStore";
import {
  getCommentIdForEditor,
  getConnectionScopeForDocument,
  getConnectionScopeForEditor,
  resolveEditorConnectionScope,
  getEditorContentType,
  getTicketIdForDocument,
  getTicketIdForEditor,
  getTicketIdForUri,
  isTicketEditor,
  markEditorActive,
  NEW_TICKET_DRAFT_ID,
  registerCommentDocument,
  registerTicketDocument,
  removeTicketEditorByDocument,
} from "../views/ticketEditorRegistry";
import { setViewContext } from "../views/viewContext";
import type { SyncController } from "./syncController";
import { parseCommentUpdateFile, parseCommentUpdateFilename } from "../views/commentUpdateFile";
import { createPendingDocumentChangeScheduler } from "./editorDocumentChangeScheduler";
import {
  clearCommentEditingFromDocument,
  updateCommentEditingStatusFromDocument,
  updateTicketDraftStatusFromDocument,
} from "./editorDocumentPreview";

export {
  clearCommentEditingFromDocument,
  updateCommentEditingStatusFromDocument,
  updateTicketDraftStatusFromDocument,
} from "./editorDocumentPreview";

export const TICKET_EDITOR_CONTEXT_KEY = "redmine-client.isTicketEditor";
export const EXISTING_TICKET_EDITOR_CONTEXT_KEY = "redmine-client.isExistingTicketEditor";

export const isExistingTicketEditor = (editor?: vscode.TextEditor): boolean => {
  if (!editor || !isTicketEditor(editor)) {
    return false;
  }
  const contentType = getEditorContentType(editor);
  if (contentType !== "ticket" && contentType !== "comment" && contentType !== "commentDraft") {
    return false;
  }
  const ticketId = getTicketIdForEditor(editor);
  return ticketId !== undefined && ticketId !== NEW_TICKET_DRAFT_ID && ticketId > 0;
};

export const resolveActiveTicketForEditor = (
  editor?: vscode.TextEditor,
): { ticketId: number; connectionScope?: string } | undefined => {
  if (!editor || !isExistingTicketEditor(editor)) {
    return undefined;
  }
  const ticketId = getTicketIdForEditor(editor);
  if (ticketId === undefined || ticketId <= 0) {
    return undefined;
  }
  return {
    ticketId,
    connectionScope: getConnectionScopeForEditor(editor),
  };
};

export const resolveActiveCommentForEditor = (
  editor?: vscode.TextEditor,
): { ticketId: number; commentId?: number; documentUri?: string; connectionScope?: string } | undefined => {
  if (!editor || !isExistingTicketEditor(editor)) {
    return undefined;
  }
  const contentType = getEditorContentType(editor);
  if (contentType !== "comment" && contentType !== "commentDraft") {
    return undefined;
  }
  const ticketId = getTicketIdForEditor(editor);
  if (ticketId === undefined || ticketId <= 0) {
    return undefined;
  }
  const commentId = contentType === "comment" ? getCommentIdForEditor(editor) : undefined;
  return {
    ticketId,
    ...(commentId !== undefined && commentId > 0 ? { commentId } : {}),
    documentUri: editor.document.uri.toString(),
    connectionScope: getConnectionScopeForEditor(editor),
  };
};

export const refreshTicketEditorContexts = (
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
): void => {
  void setViewContext(TICKET_EDITOR_CONTEXT_KEY, !!editor && isTicketEditor(editor));
  void setViewContext(EXISTING_TICKET_EDITOR_CONTEXT_KEY, isExistingTicketEditor(editor));
};

export const buildRegisterEditorDocument = (): (
  document: vscode.TextDocument,
) => void => {
  return (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return;
    }
    const existingTicketId =
      getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
    if (existingTicketId !== undefined) {
      return;
    }

    const filename = path.basename(document.uri.path);
    const parsed = parseEditorFilename(filename);
    if (parsed) {
      if (parsed.type === "ticket") {
        registerTicketDocument(parsed.ticketId, document, "ticket", parsed.projectId);
      } else {
        registerCommentDocument(
          parsed.ticketId,
          parsed.commentId,
          document,
          parsed.projectId,
          resolveEditorConnectionScope(document.uri),
        );
      }
      return;
    }

    const commentUpdateIdentity =
      parseCommentUpdateFilename(filename) ??
      (document.uri.scheme === "untitled"
        ? parseCommentUpdateFilename(filename.replace(/^redmine-client-[a-f0-9]{16}-/i, ""))
        : undefined);
    if (commentUpdateIdentity) {
      const parsedComment = parseCommentUpdateFile(document.getText());
      registerCommentDocument(
        commentUpdateIdentity.issueId,
        commentUpdateIdentity.journalId,
        document,
        parsedComment?.fields.projectId,
        resolveEditorConnectionScope(document.uri),
      );
      return;
    }

    const draftTicketId = parseNewCommentDraftFilename(filename);
    if (draftTicketId) {
      const finalized = parseCommentUpdateFile(document.getText());
      if (finalized && finalized.fields.issueId === draftTicketId) {
        registerCommentDocument(
          finalized.fields.issueId,
          finalized.fields.journalId,
          document,
          finalized.fields.projectId,
          resolveEditorConnectionScope(document.uri),
        );
        return;
      }
      registerTicketDocument(draftTicketId, document, "commentDraft");
      return;
    }

    const directTicketId = parseDirectTicketFilename(filename);
    if (directTicketId !== undefined) {
      let projectId: number | undefined;
      try {
        const parsedContent = parseTicketEditorContent(document.getText(), {
          allowEmptyStatus: true,
          allowMissingMetadata: true,
          fallbackMetadata: {
            tracker: "",
            priority: "",
            status: "",
            due_date: "",
            children: [],
          },
          allowMissingSubject: true,
        });
        projectId = parsedContent.controlFields?.project_id;
      } catch {
        projectId = undefined;
      }
      registerTicketDocument(directTicketId, document, "ticket", projectId);
      return;
    }

    if (isNewTicketDraftFilename(filename)) {
      try {
        const parsedContent = parseTicketEditorContent(document.getText(), {
          allowMissingMetadata: true,
          fallbackMetadata: {
            tracker: "",
            priority: "",
            status: "",
            due_date: "",
            children: [],
          },
          allowMissingSubject: true,
        });
        const issueId = parsedContent.controlFields?.issue_id;
        const projectId = parsedContent.controlFields?.project_id;
        if (parsedContent.controlFields?.mode === "ticket-update" && typeof issueId === "number") {
          registerTicketDocument(issueId, document, "ticket", projectId);
          return;
        }
      } catch {
        // Ignore parse errors and fall back to new draft registration.
      }
      registerTicketDocument(NEW_TICKET_DRAFT_ID, document, "ticket");
    }
  };
};

export const buildUpdateTicketStatus = (
  statusBarItem: vscode.StatusBarItem,
): ((editor?: vscode.TextEditor) => void) => {
  return (editor?: vscode.TextEditor): void => {
    if (!editor || !isTicketEditor(editor)) {
      statusBarItem.hide();
      return;
    }
    const ticketId = getTicketIdForEditor(editor);
    if (!ticketId) {
      statusBarItem.hide();
      return;
    }
    statusBarItem.text = formatTicketLabel(ticketId);
    statusBarItem.tooltip = vscode.l10n.t("Redmine ticket");
    statusBarItem.show();
  };
};

export interface EditorEventDeps {
  registerEditorDocument: (document: vscode.TextDocument) => void;
  updateTicketStatus: (editor?: vscode.TextEditor) => void;
  notifyTicketChanged: () => void;
  sync: Pick<SyncController, "syncOnSave">;
  onActiveTicketChanged?: (ticketId: number, connectionScope?: string) => void;
  onActiveCommentChanged?: (
    target: { ticketId: number; commentId?: number; documentUri?: string },
    connectionScope?: string,
  ) => void;
}

export const registerEditorEvents = (
  context: Pick<vscode.ExtensionContext, "subscriptions">,
  deps: EditorEventDeps,
): void => {
  const {
    registerEditorDocument,
    updateTicketStatus,
    notifyTicketChanged,
    sync,
    onActiveTicketChanged,
    onActiveCommentChanged,
  } = deps;

  let previousActiveEditor = vscode.window.activeTextEditor;
  const documentChanges = createPendingDocumentChangeScheduler((document) => {
    if (
      updateTicketDraftStatusFromDocument(document) ||
      updateCommentEditingStatusFromDocument(document)
    ) {
      notifyTicketChanged();
    }
  });

  context.subscriptions.push({
    dispose: () => documentChanges.dispose(),
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      documentChanges.flushAll();

      if (previousActiveEditor && isTicketEditor(previousActiveEditor)) {
        const ticketId = getTicketIdForEditor(previousActiveEditor);
        const contentType = getEditorContentType(previousActiveEditor);
        if (ticketId && contentType === "ticket" && previousActiveEditor.document.isDirty) {
          try {
            const parsed = parseTicketEditorContent(
              previousActiveEditor.document.getText(),
            );
            setTicketDraftContent(
              ticketId,
              parsed,
              getConnectionScopeForEditor(previousActiveEditor),
            );
            if (updateTicketDraftStatusFromDocument(previousActiveEditor.document)) {
              notifyTicketChanged();
            }
          } catch {
            // Ignore parse errors when swapping focus.
          }
        } else if (ticketId && contentType === "comment") {
          const draft = previousActiveEditor.document.getText();
          setCommentDraft(
            ticketId,
            draft,
            getConnectionScopeForEditor(previousActiveEditor),
          );
          const commentId = getCommentIdForEditor(previousActiveEditor);
          if (commentId) {
            setCommentDraftBody(
              commentId,
              draft,
              getConnectionScopeForEditor(previousActiveEditor),
            );
          }
        }
      }

      if (editor) {
        registerEditorDocument(editor.document);
        markEditorActive(editor);
      }

      previousActiveEditor = editor;
      refreshTicketEditorContexts(editor);
      updateTicketStatus(editor);
      const activeComment = resolveActiveCommentForEditor(editor);
      if (activeComment && onActiveCommentChanged) {
        onActiveCommentChanged(
          {
            ticketId: activeComment.ticketId,
            commentId: activeComment.commentId,
            documentUri: activeComment.documentUri,
          },
          activeComment.connectionScope,
        );
      } else {
        const activeTicket = resolveActiveTicketForEditor(editor);
        if (activeTicket) {
          onActiveTicketChanged?.(activeTicket.ticketId, activeTicket.connectionScope);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        documentChanges.schedule(event.document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      documentChanges.clear(document.uri.toString());
      if (clearCommentEditingFromDocument(document)) {
        notifyTicketChanged();
      }
      removeTicketEditorByDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      registerEditorDocument(document);
      if (vscode.window.activeTextEditor?.document === document) {
        refreshTicketEditorContexts(vscode.window.activeTextEditor);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      sync.syncOnSave(document);
    }),
  );
};
