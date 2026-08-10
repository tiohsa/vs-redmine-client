import * as assert from "assert";
import * as vscode from "vscode";
import { applyEditorContent } from "../views/ticketPreview";

suite("applyEditorContent local finalize", () => {
  test("editor.edit=false を成功として扱わない", async () => {
    const document = {
      getText: () => "old",
      positionAt: (offset: number) => new vscode.Position(0, offset),
    } as vscode.TextDocument;
    const editor = {
      document,
      edit: async () => false,
    } as unknown as vscode.TextEditor;

    await assert.rejects(
      () => applyEditorContent(editor, "new"),
      /editor_edit_failed/,
    );
  });
});
