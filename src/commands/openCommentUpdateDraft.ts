import * as vscode from "vscode";
import { Comment } from "../redmine/types";
import { Ticket } from "../redmine/types";
import { computeNotesHash } from "../utils/notesHash";
import {
  buildCommentUpdateFilename,
  buildCommentUpdateFileContent,
  CommentUpdateFileFields,
} from "../views/commentUpdateFile";
import { ensureScopedEditorFile, resolveEditorStorageDir } from "../views/ticketPreview";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";

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

  const connectionScope = getCurrentConnectionScope();
  const storageResolution = resolveEditorStorageDir({ connectionScope });
  let fileUri: vscode.Uri;

  if (storageResolution.uri) {
    await vscode.workspace.fs.createDirectory(storageResolution.uri);
    fileUri = vscode.Uri.joinPath(storageResolution.uri, filename);
    const legacyFileUri = storageResolution.legacyUri
      ? vscode.Uri.joinPath(storageResolution.legacyUri, filename)
      : undefined;
    await ensureScopedEditorFile({ fileUri, legacyFileUri, initialContent: fileContent });
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });
  } else {
    const untitledUri = vscode.Uri.parse(
      `untitled:redmine-client-${getConnectionScopeHash(connectionScope)}-${filename}`,
    );
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
