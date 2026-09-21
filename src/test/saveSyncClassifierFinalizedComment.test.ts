import * as assert from "assert";
import * as vscode from "vscode";
import { classifyDocumentSave } from "../app/saveSyncClassifier";
import { computeNotesHash } from "../utils/notesHash";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import {
  clearRegistry,
  registerNewCommentDraft,
  setEditorCommentId,
} from "../views/ticketEditorRegistry";
import { createMutableEditorStub } from "./helpers/editorStubs";

const createNewCommentEditor = (content: string) =>
  createMutableEditorStub(
    vscode.Uri.parse("file:///tmp/redmine-client-new-comment-39.md"),
    content,
  );

suite("saveSyncClassifier finalized new-comment fail-closed", () => {
  setup(() => clearRegistry());
  teardown(() => clearRegistry());

  test("TC-01: plain new-comment は draftCommentNew", () => {
    const editor = createNewCommentEditor("新規コメント");

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "draftCommentNew",
      ticketId: 39,
    });
  });

  test("TC-02: finalize 済みの正常ファイルは commentUpdateFile", () => {
    const content = buildCommentUpdateFileContent({
      issueId: 39,
      journalId: 777,
      sourceNotesHash: computeNotesHash("作成済みコメント"),
    }, "作成済みコメント");
    const editor = createNewCommentEditor(content);

    const result = classifyDocumentSave(editor.document, editor);
    assert.strictEqual(result.kind, "commentUpdateFile");
    if (result.kind === "commentUpdateFile") {
      assert.strictEqual(result.parsed.fields.journalId, 777);
    }
  });

  test("TC-03: registry identity がある metadata 破損は invalidCommentUpdateFile", () => {
    const editor = createNewCommentEditor([
      "---",
      "mode: broken",
      "issue_id: 39",
      "journal_id: 777",
      "source_notes_hash: sha256:broken",
      "---",
      "",
      "本文",
    ].join("\n"));
    registerNewCommentDraft(39, editor);
    setEditorCommentId(editor, 777);

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "invalidCommentUpdateFile",
    });
  });

  test("TC-04: registry がなく mode が破損していても marker があれば invalid", () => {
    const editor = createNewCommentEditor([
      "---",
      "mode: broken",
      "issue_id: 39",
      "journal_id: 777",
      "source_notes_hash: sha256:broken",
      "---",
      "",
      "本文",
    ].join("\n"));

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "invalidCommentUpdateFile",
    });
  });

  test("TC-05: source_notes_hash 欠損は invalidCommentUpdateFile", () => {
    const editor = createNewCommentEditor([
      "---",
      "mode: comment-update",
      "issue_id: 39",
      "journal_id: 777",
      "---",
      "",
      "本文",
    ].join("\n"));

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "invalidCommentUpdateFile",
    });
  });

  test("TC-06: frontmatter 終端欠損は invalidCommentUpdateFile", () => {
    const editor = createNewCommentEditor([
      "---",
      "mode: comment-update",
      "issue_id: 39",
      "journal_id: 777",
      "source_notes_hash: sha256:broken",
    ].join("\n"));

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "invalidCommentUpdateFile",
    });
  });

  test("TC-07: Markdown 本文中だけの marker は plain new-comment", () => {
    const editor = createNewCommentEditor([
      "新規コメントです。",
      "",
      "journal_id: 123",
      "",
      "source_notes_hash: example",
    ].join("\n"));

    assert.deepStrictEqual(classifyDocumentSave(editor.document, editor), {
      kind: "draftCommentNew",
      ticketId: 39,
    });
  });
});
