import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildCommentEditorContent,
  buildTicketPreviewContent,
} from "../views/ticketPreview";
import { finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { getCommentEdit } from "../views/commentEditStore";
import { getCommentIdForDocument } from "../views/ticketEditorRegistry";
import { createDocumentStub } from "./helpers/editorStubs";

suite("Comment editor binding", () => {
  test("builds ticket preview without comment content", () => {
    const content = buildTicketPreviewContent({
      subject: "Ticket",
      description: "Details",
    });

    assert.ok(content.includes("# Ticket"));
    assert.ok(content.includes("Details"));
  });

  test("builds comment editor content from comment body", () => {
    const content = buildCommentEditorContent("Comment body");

    assert.strictEqual(content, "Comment body");
  });

  test("finalizes draft state even when editor is closed", () => {
    const document = createDocumentStub(
      vscode.Uri.parse("untitled:redmine-client-new-comment-7.md"),
      "Body",
    );

    finalizeNewCommentDraftDocument({
      document,
      ticketId: 7,
      projectId: 2,
      commentId: 33,
    });

    assert.strictEqual(getCommentIdForDocument(document), 33);
    const edit = getCommentEdit(33);
    assert.strictEqual(edit?.ticketId, 7);
    assert.strictEqual(edit?.baseBody, "Body");
  });
});
