import * as assert from "assert";
import * as vscode from "vscode";
import { editComment } from "../commands/editComment";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";
import { getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { computeNotesHash } from "../utils/notesHash";

suite("Edit comment command", () => {
  setup(() => initializeOfflineSyncStore(createTestMemento()));
  test("uploads images and passes upload tokens", async () => {
    const temp = createTempImage();
    const editor = {
      document: {
        uri: temp.documentUri,
        getText: () => buildCommentUpdateFileContent(
          { issueId: 10, journalId: 5, sourceNotesHash: computeNotesHash("![img](./image.png)") },
          "![img](./image.png)",
        ),
      },
    } as unknown as vscode.TextEditor;

    let updatedBody: string | undefined;
    let updatedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;

    await editComment(
      {
        id: 5,
        ticketId: 10,
        authorId: 1,
        authorName: "User",
        body: "Old",
        createdAt: "t1",
        updatedAt: "t2",
        editableByCurrentUser: true,
      },
      {
        getActiveEditor: () => editor,
        updateComment: async (_commentId, body, uploads) => {
          updatedBody = body;
          updatedUploads = uploads;
        },
        uploadFile: async () => ({
          token: "token",
          filename: "image.png",
          contentType: "image/png",
        }),
        showError: () => undefined,
        showInfo: () => undefined,
        validateComment,
        getCommentLimitGuidance,
        setCommentDraft: () => undefined,
        clearCommentDraft: () => undefined,
        getTicketIdForEditor: () => 10,
        getEditorContentType: () => "comment",
        commentSyncDeps: {
          addComment: async () => undefined,
          updateIssue: async () => undefined,
          getCurrentUserId: async () => 1,
          getIssueDetail: async () => ({
            ticket: { id: 10, subject: "T", projectId: 1 },
            comments: [{
              id: 5,
              ticketId: 10,
              authorId: 1,
              authorName: "User",
              body: "Old",
              updatedAt: "t2",
              editableByCurrentUser: true,
            }],
          }),
        },
      },
    );

    assert.strictEqual(updatedBody, "![img](image.png)");
    assert.deepStrictEqual(updatedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });

  test("壊れたcomment-update metadataをコメント更新として送信しない", async () => {
    const editor = {
      document: {
        uri: vscode.Uri.file("/workspace/redmine-client-comment-update-10-5.md"),
        getText: () => "---\nmode: comment-update\nissue_id: 10\njournal_id: 5\n---\n\n修正本文",
      },
    } as unknown as vscode.TextEditor;
    let updateCalls = 0;
    let errorMessage: string | undefined;

    await editComment(
      {
        id: 5,
        ticketId: 10,
        authorId: 1,
        authorName: "User",
        body: "Old",
        createdAt: "t1",
        updatedAt: "t2",
        editableByCurrentUser: true,
      },
      {
        getActiveEditor: () => editor,
        updateComment: async () => { updateCalls++; },
        uploadFile: async () => ({ token: "token", filename: "image.png", contentType: "image/png" }),
        showError: (message) => { errorMessage = message; },
        showInfo: () => undefined,
        validateComment,
        getCommentLimitGuidance,
        setCommentDraft: () => undefined,
        clearCommentDraft: () => undefined,
        getTicketIdForEditor: () => 10,
        getEditorContentType: () => "comment",
      },
    );

    assert.strictEqual(updateCalls, 0);
    assert.match(errorMessage ?? "", /metadata is invalid/i);
  });

  for (const testCase of [
    { name: "ticket", issueId: 99, journalId: 5 },
    { name: "comment", issueId: 10, journalId: 6 },
  ]) {
    test(`${testCase.name} identity不一致をremoteへ送信しない`, async () => {
      const editor = {
        document: {
          uri: vscode.Uri.file("/workspace/redmine-client-comment-update-10-5.md"),
          getText: () => buildCommentUpdateFileContent(
            {
              issueId: testCase.issueId,
              journalId: testCase.journalId,
              sourceNotesHash: computeNotesHash("修正本文"),
            },
            "修正本文",
          ),
        },
      } as unknown as vscode.TextEditor;
      let updateCalls = 0;
      let errorMessage: string | undefined;

      await editComment(
        {
          id: 5,
          ticketId: 10,
          authorId: 1,
          authorName: "User",
          body: "Old",
          createdAt: "t1",
          updatedAt: "t2",
          editableByCurrentUser: true,
        },
        {
          getActiveEditor: () => editor,
          updateComment: async () => { updateCalls++; },
          uploadFile: async () => ({ token: "token", filename: "image.png", contentType: "image/png" }),
          showError: (message) => { errorMessage = message; },
          showInfo: () => undefined,
          validateComment,
          getCommentLimitGuidance,
          setCommentDraft: () => undefined,
          clearCommentDraft: () => undefined,
          getTicketIdForEditor: () => 10,
          getEditorContentType: () => "comment",
        },
      );

      assert.strictEqual(updateCalls, 0);
      assert.strictEqual(getOfflineSyncQueue().comments.length, 0);
      assert.match(errorMessage ?? "", /metadata is invalid/i);
    });
  }
});
