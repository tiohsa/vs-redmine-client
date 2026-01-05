import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getDefaultProjectId } from "../config/settings";
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
  resolveNewTicketDraftContent,
} from "../views/ticketPreview";
import { buildUniqueUntitledName, buildUniqueUntitledPath } from "../views/untitledPath";
import { buildEmptyTicketDraftContent } from "../views/ticketDraftStore";
import { TicketEditorContent } from "../views/ticketEditorContent";
import { showError } from "../utils/notifications";

const DRAFT_FILENAME = "redmine-client-new-ticket.md";

const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

const getWorkspacePath = (): string | undefined =>
  vscode.workspace.workspaceFolders?.[0]?.uri.path;

const buildNewTicketTemplate = (content: TicketEditorContent): string =>
  buildTicketEditorContent(content);

const resolveProjectId = (selection: ProjectSelection): number | undefined => {
  if (selection.id) {
    return selection.id;
  }

  const fallback = Number(getDefaultProjectId());
  return Number.isNaN(fallback) ? undefined : fallback;
};

const isFileExistsOrOpen = (candidate: string): boolean =>
  fs.existsSync(candidate) ||
  vscode.workspace.textDocuments.some((doc) => doc.uri.fsPath === candidate);

const getOpenUntitledNames = (): Set<string> =>
  new Set(
    vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === "untitled")
      .map((doc) => path.posix.basename(doc.uri.path)),
  );

export const buildNewTicketDraftUri = (
  workspacePath?: string,
  existsSync: (candidate: string) => boolean = isFileExistsOrOpen,
): vscode.Uri => {
  if (!workspacePath) {
    const takenNames = getOpenUntitledNames();
    const uniqueName = buildUniqueUntitledName(
      DRAFT_FILENAME,
      (candidate) => takenNames.has(candidate),
    );
    return vscode.Uri.parse(`untitled:${uniqueName}`);
  }

  const targetPath = buildUniqueUntitledPath(workspacePath, DRAFT_FILENAME, existsSync);
  return vscode.Uri.parse(`untitled:${targetPath}`);
};

export const openNewTicketDraft = async (input: {
  content: TicketEditorContent;
  projectId?: number;
}): Promise<void> => {
  const knownUri =
    getNewTicketDraftUri() ?? buildNewTicketDraftUri(getWorkspacePath());
  const existing = findOpenDocument(knownUri);
  const document = existing ?? (await vscode.workspace.openTextDocument(knownUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  registerNewTicketDraft(editor);
  if (input.projectId) {
    setEditorProjectId(editor, input.projectId);
  }

  if (document.getText().trim().length === 0) {
    const templateText = buildNewTicketTemplate(input.content);
    await applyEditorContent(editor, templateText);
    if (input.content.subject.trim().length === 0) {
      const position = findEmptySubjectPosition(templateText);
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
};

export const createTicketFromList = async (): Promise<void> => {
  const selection = getProjectSelection();
  const projectId = resolveProjectId(selection);
  const templateResolution = resolveNewTicketDraftContent({
    projectName: selection.name,
  });
  if (templateResolution.isTemplateConfigured && templateResolution.errorMessage) {
    showError(templateResolution.errorMessage);
  }
  await openNewTicketDraft({
    content: templateResolution.content ?? buildEmptyTicketDraftContent(),
    projectId,
  });
};
