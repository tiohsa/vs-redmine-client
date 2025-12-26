import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  getLastActiveEditor,
  getPrimaryEditor,
  getTicketEditors,
  getTicketIdForEditor,
  markEditorActive,
  registerTicketEditor,
  removeTicketEditorByDocument,
  removeTicketEditorByUri,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Ticket editor registry", () => {
  teardown(() => {
    clearRegistry();
  });

  test("tracks primary and extra editors", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-1"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-1-extra"), "");

    registerTicketEditor(1, primary, "primary", "ticket");
    registerTicketEditor(1, extra, "extra", "ticket");

    const editors = getTicketEditors(1);
    assert.strictEqual(editors.length, 2);
    assert.ok(editors.some((record) => record.kind === "primary"));
    assert.ok(editors.some((record) => record.kind === "extra"));
  });

  test("resolves last active editor", async () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-2"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-2-extra"), "");

    registerTicketEditor(2, primary, "primary", "ticket");
    registerTicketEditor(2, extra, "extra", "ticket");

    markEditorActive(primary);
    await new Promise((resolve) => setTimeout(resolve, 5));
    markEditorActive(extra);

    const lastActive = getLastActiveEditor(2);
    assert.ok(lastActive);
    assert.strictEqual(lastActive?.uri, extra.document.uri.toString());
  });

  test("removes closed editors", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-3"), "");
    registerTicketEditor(3, primary, "primary", "ticket");

    removeTicketEditorByDocument(primary.document);

    assert.strictEqual(getPrimaryEditor(3), undefined);
    assert.strictEqual(getTicketEditors(3).length, 0);
  });

  test("keeps record when document uri changes", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-4"), "");
    registerTicketEditor(4, primary, "primary", "ticket");

    (primary.document as { uri: vscode.Uri }).uri = vscode.Uri.parse("file:/tmp/ticket-4.md");

    assert.strictEqual(getTicketIdForEditor(primary), 4);
  });
});
