import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getDefaultProjectId, getEditorStorageDirectory } from "../config/settings";
import { getProjectSelection, ProjectSelection } from "../config/projectSelection";
import {
  getNewTicketDraftUri,
  registerNewTicketDraft,
  setEditorProjectId,
} from "../views/ticketEditorRegistry";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import {
  applyEditorContent,
  findEmptySubjectPosition,
} from "../views/ticketPreview";
import { buildUniqueUntitledName, buildUniqueUntitledPath } from "../views/untitledPath";
import { buildNewTicketDraftContent } from "../views/ticketDraftStore";
import { TicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import {
  buildNewTicketDraftFilename,
} from "../views/editorFilename";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";

const getDraftFilename = (scopeHash?: string): string =>
  scopeHash ? buildNewTicketDraftFilename(scopeHash) : "redmine-client-new-ticket.md";

const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

const getWorkspacePath = (): string | undefined =>
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

const getEditorBasePath = (): string | undefined => {
  const configured = getEditorStorageDirectory();
  if (configured && path.isAbsolute(configured)) {
    return configured;
  }
  return getWorkspacePath();
};

const buildNewTicketDraftText = (content: TicketEditorContent): string =>
  buildTicketEditorContent(content);

const resolveProjectId = (selection: ProjectSelection): number | undefined => {
  if (selection.id) {
    return selection.id;
  }

  const fallback = Number(getDefaultProjectId());
  return Number.isNaN(fallback) ? undefined : fallback;
};

const isFileExistsOrOpen = (candidate: string): boolean => {
  const fsPath = vscode.Uri.file(candidate).fsPath;
  return (
    fs.existsSync(fsPath) ||
    vscode.workspace.textDocuments.some((doc) => doc.uri.fsPath === fsPath)
  );
};

const getOpenUntitledNames = (): Set<string> =>
  new Set(
    vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === "untitled")
      .map((doc) => path.posix.basename(doc.uri.path.replace(/\\/g, "/"))),
  );

export const buildNewTicketDraftUri = (
  workspacePath?: string,
  existsSync: (candidate: string) => boolean = isFileExistsOrOpen,
  scopeHash?: string,
): vscode.Uri => {
  if (!workspacePath) {
    const takenNames = getOpenUntitledNames();
    const draftFilename = getDraftFilename(scopeHash);
    const uniqueName = buildUniqueUntitledName(
      draftFilename,
      (candidate) => takenNames.has(candidate),
    );
    return vscode.Uri.parse(`untitled:${uniqueName}`);
  }

  const targetPath = buildUniqueUntitledPath(workspacePath, getDraftFilename(scopeHash), existsSync);
  return vscode.Uri.file(targetPath).with({ scheme: "untitled" });
};

const isAlreadySyncedDocument = (document: vscode.TextDocument): boolean => {
  const text = document.getText().trim();
  if (!text) { return false; }
  try {
    const parsed = parseTicketEditorContent(text, {
      allowMissingMetadata: true,
      fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      allowMissingSubject: true,
    });
    return parsed.controlFields?.mode === "ticket-update";
  } catch {
    return false;
  }
};

export const openNewTicketDraft = async (input: {
  content: TicketEditorContent;
  projectId?: number;
}): Promise<vscode.Uri> => {
  const scopeHash = getConnectionScopeHash(getCurrentConnectionScope());
  const knownUri =
    getNewTicketDraftUri() ?? buildNewTicketDraftUri(getEditorBasePath(), isFileExistsOrOpen, scopeHash);
  let existing = findOpenDocument(knownUri);
  if (existing && isAlreadySyncedDocument(existing)) {
    existing = undefined;
  }
  const targetUri = existing
    ? knownUri
    : buildNewTicketDraftUri(getEditorBasePath(), isFileExistsOrOpen, scopeHash);
  const document = existing ?? (await vscode.workspace.openTextDocument(targetUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  registerNewTicketDraft(editor);
  if (input.projectId) {
    setEditorProjectId(editor, input.projectId);
  }

  if (document.getText().trim().length === 0) {
    const draftText = buildNewTicketDraftText(input.content);
    await applyEditorContent(editor, draftText);
    if (input.content.subject.trim().length === 0) {
      const position = findEmptySubjectPosition(draftText);
      if (position) {
        editor.selection = new vscode.Selection(
          new vscode.Position(position.line, position.character),
          new vscode.Position(position.line, position.character),
        );
        editor.revealRange(
          new vscode.Range(
            new vscode.Position(position.line, position.character),
            new vscode.Position(position.line, position.character),
          ),
        );
      }
    }
  }

  return document.uri;
};

export const createTicketFromList = async (): Promise<void> => {
  const selection = getProjectSelection();
  const projectId = resolveProjectId(selection);
  await openNewTicketDraft({
    content: buildNewTicketDraftContent({ projectId }),
    projectId,
  });
};
