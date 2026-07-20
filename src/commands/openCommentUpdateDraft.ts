import * as vscode from "vscode";
import { Comment } from "../redmine/types";
import { Ticket } from "../redmine/types";
import { computeNotesHash } from "../utils/notesHash";
import {
  buildCommentUpdateFilename,
  buildCommentUpdateFileContent,
  CommentUpdateFileFields,
} from "../views/commentUpdateFile";
import { resolveEditorStorageDir } from "../views/ticketPreview";

export const shouldSeedStoredCommentDraft = (exists: boolean): boolean => !exists;

export const shouldSeedUntitledCommentDraft = (content: string): boolean =>
  content.length === 0;

export const openCommentUpdateDraft = async (
  comment: Comment,
  ticket: Pick<Ticket, "id" | "subject" | "projectId" | "projectName">,
): Promise<void> => {
  const filename = buildCommentUpdateFilename(comment.ticketId, comment.id);
  const fields: CommentUpdateFileFields = {
    issueId: comment.ticketId,
    journalId: comment.id,
    projectId: ticket.projectId,
    projectName: ticket.projectName,
    issueSubject: ticket.subject,
    commentAuthor: comment.authorName,
    commentCreatedOn: comment.createdAt,
    sourceNotesHash: computeNotesHash(comment.body),
  };
  const fileContent = buildCommentUpdateFileContent(fields, comment.body);

  const storageResolution = resolveEditorStorageDir();
  let fileUri: vscode.Uri;

  if (storageResolution.uri) {
    await vscode.workspace.fs.createDirectory(storageResolution.uri);
    fileUri = vscode.Uri.joinPath(storageResolution.uri, filename);
    let exists = true;
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
        exists = false;
      } else {
        throw err;
      }
    }
    // 既存ファイルはユーザーの下書きである可能性があるため、再オープン時に上書きしない。
    if (shouldSeedStoredCommentDraft(exists)) {
      await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(fileContent));
    }
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });
  } else {
    const untitledUri = vscode.Uri.parse(`untitled:${filename}`);
    const document = await vscode.workspace.openTextDocument(untitledUri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    // 同じ untitled ドキュメントを再利用した場合も、入力済み内容を保持する。
    if (shouldSeedUntitledCommentDraft(document.getText())) {
      await editor.edit((b) => {
        b.insert(new vscode.Position(0, 0), fileContent);
      });
    }
  }
};
