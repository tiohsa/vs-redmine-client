import * as assert from "assert";
import * as vscode from "vscode";
import { finalizeNewCommentDraftState } from "../views/commentSaveSync";
import { getCommentEdit } from "../views/commentEditStore";
import {
  getCommentIdForEditor,
  getEditorContentType,
  registerNewCommentDraft,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Comment save rename", () => {
  test("finalizes draft by switching to comment mode", () => {
    const editor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-comment-10.md"),
      "Body",
    );
    registerNewCommentDraft(10, editor);

    finalizeNewCommentDraftState({
      editor,
      ticketId: 10,
      projectId: 2,
      commentId: 55,
    });

    assert.strictEqual(getEditorContentType(editor), "comment");
    assert.strictEqual(getCommentIdForEditor(editor), 55);

    const edit = getCommentEdit(55);
    assert.strictEqual(edit?.ticketId, 10);
    assert.strictEqual(edit?.baseBody, "Body");
  });
});
