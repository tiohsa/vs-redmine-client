import * as vscode from "vscode";
import { computeNotesHash } from "../utils/notesHash";

export interface CommentUpdateFileFields {
  issueId: number;
  journalId: number;
  projectId?: number;
  projectName?: string;
  issueSubject?: string;
  commentAuthor?: string;
  commentCreatedOn?: string;
  sourceNotesHash: string;
  lastSyncedAt?: string;
}

const FILENAME_PATTERN = /^redmine-client-comment-update-(\d+)-(\d+)(?:-\d+)?\.md$/;

export const buildCommentUpdateFilename = (issueId: number, journalId: number): string =>
  `redmine-client-comment-update-${issueId}-${journalId}.md`;

export const isCommentUpdateFilename = (filename: string): boolean =>
  FILENAME_PATTERN.test(filename);

export const buildCommentUpdateFileContent = (
  fields: CommentUpdateFileFields,
  body: string,
): string => {
  const lines: string[] = [
    "mode: comment-update",
    `issue_id: ${fields.issueId}`,
    `journal_id: ${fields.journalId}`,
  ];
  if (fields.projectId !== undefined) { lines.push(`project_id: ${fields.projectId}`); }
  if (fields.projectName) { lines.push(`project_name: ${fields.projectName}`); }
  if (fields.issueSubject) { lines.push(`issue_subject: ${fields.issueSubject}`); }
  if (fields.commentAuthor) { lines.push(`comment_author: ${fields.commentAuthor}`); }
  if (fields.commentCreatedOn) { lines.push(`comment_created_on: ${fields.commentCreatedOn}`); }
  if (fields.lastSyncedAt) { lines.push(`last_synced_at: ${fields.lastSyncedAt}`); }
  lines.push(`source_notes_hash: ${fields.sourceNotesHash}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
};

export interface ParsedCommentUpdateFile {
  fields: CommentUpdateFileFields;
  body: string;
}

export const parseCommentUpdateFile = (content: string): ParsedCommentUpdateFile | undefined => {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") { return undefined; }
  const closeIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (closeIdx === -1) { return undefined; }

  const fm: Record<string, string> = {};
  for (const line of lines.slice(1, closeIdx)) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) { fm[m[1]] = m[2].trim(); }
  }

  if (fm["mode"] !== "comment-update") { return undefined; }

  const issueId = fm["issue_id"] ? Number(fm["issue_id"]) : NaN;
  const journalId = fm["journal_id"] ? Number(fm["journal_id"]) : NaN;
  const sourceNotesHash = fm["source_notes_hash"];

  if (Number.isNaN(issueId) || Number.isNaN(journalId) || !sourceNotesHash) { return undefined; }

  const fields: CommentUpdateFileFields = { issueId, journalId, sourceNotesHash };
  if (fm["project_id"]) { fields.projectId = Number(fm["project_id"]); }
  if (fm["project_name"]) { fields.projectName = fm["project_name"]; }
  if (fm["issue_subject"]) { fields.issueSubject = fm["issue_subject"]; }
  if (fm["comment_author"]) { fields.commentAuthor = fm["comment_author"]; }
  if (fm["comment_created_on"]) { fields.commentCreatedOn = fm["comment_created_on"]; }
  if (fm["last_synced_at"]) { fields.lastSyncedAt = fm["last_synced_at"]; }

  const body = lines.slice(closeIdx + 1).join("\n").replace(/^\n/, "");
  return { fields, body };
};

export const updateCommentUpdateFileAfterSync = async (
  documentUri: string,
  syncedBody: string,
): Promise<void> => {
  const uri = vscode.Uri.parse(documentUri);
  let raw: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    raw = new TextDecoder().decode(bytes);
  } catch {
    return;
  }

  const parsed = parseCommentUpdateFile(raw);
  if (!parsed) { return; }

  const newFields: CommentUpdateFileFields = {
    ...parsed.fields,
    sourceNotesHash: computeNotesHash(syncedBody),
    lastSyncedAt: new Date().toISOString(),
  };
  const updated = buildCommentUpdateFileContent(newFields, syncedBody);

  try {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
  } catch {
    // ファイル書き戻し失敗は無視する
  }

  const openDoc = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === documentUri,
  );
  if (openDoc) {
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === documentUri,
    );
    for (const editor of editors) {
      const current = editor.document.getText();
      if (current !== updated) {
        await editor.edit((b) => {
          b.replace(
            new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(current.length),
            ),
            updated,
          );
        });
      }
    }
  }
};
