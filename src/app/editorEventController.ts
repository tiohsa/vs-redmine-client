import * as path from "path";
import * as vscode from "vscode";
import { setCommentDraft } from "../views/commentDraftStore";
import { setCommentDraftBody } from "../views/commentEditStore";
import {
  isNewTicketDraftFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import { formatTicketLabel } from "../views/ticketLabel";
import { parseTicketEditorContent } from "../views/ticketEditorContent";
import { setTicketDraftContent } from "../views/ticketDraftStore";
import {
  getCommentIdForEditor,
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

export const TICKET_EDITOR_CONTEXT_KEY = "redmine-client.isTicketEditor";

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
        );
      }
      return;
    }

    const draftTicketId = parseNewCommentDraftFilename(filename);
    if (draftTicketId) {
      registerTicketDocument(draftTicketId, document, "commentDraft");
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
  sync: Pick<SyncController, "syncOnSave">;
}

export const registerEditorEvents = (
  context: vscode.ExtensionContext,
  deps: EditorEventDeps,
): void => {
  const { registerEditorDocument, updateTicketStatus, sync } = deps;

  let previousActiveEditor = vscode.window.activeTextEditor;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (previousActiveEditor && isTicketEditor(previousActiveEditor)) {
        const ticketId = getTicketIdForEditor(previousActiveEditor);
        const contentType = getEditorContentType(previousActiveEditor);
        if (ticketId && contentType === "ticket") {
          try {
            const parsed = parseTicketEditorContent(
              previousActiveEditor.document.getText(),
            );
            setTicketDraftContent(ticketId, parsed);
          } catch {
            // Ignore parse errors when swapping focus.
          }
        } else if (ticketId && contentType === "comment") {
          const draft = previousActiveEditor.document.getText();
          setCommentDraft(ticketId, draft);
          const commentId = getCommentIdForEditor(previousActiveEditor);
          if (commentId) {
            setCommentDraftBody(commentId, draft);
          }
        }
      }

      if (editor) {
        registerEditorDocument(editor.document);
        markEditorActive(editor);
      }

      previousActiveEditor = editor;
      void setViewContext(TICKET_EDITOR_CONTEXT_KEY, !!editor && isTicketEditor(editor));
      updateTicketStatus(editor);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      removeTicketEditorByDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      registerEditorDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      sync.syncOnSave(document);
    }),
  );
};
