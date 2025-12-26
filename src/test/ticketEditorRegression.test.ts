import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  getLastActiveEditor,
  markEditorActive,
  registerTicketEditor,
  removeTicketEditorByUri,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Ticket editor regression", () => {
  teardown(() => {
    clearRegistry();
  });

  test("falls back when last active editor is closed", async () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-regression"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-regression-extra"), "");

    registerTicketEditor(40, primary, "primary", "ticket");
    registerTicketEditor(40, extra, "extra", "ticket");

    markEditorActive(primary);
    await new Promise((resolve) => setTimeout(resolve, 5));
    markEditorActive(extra);

    removeTicketEditorByUri(extra.document.uri);

    const lastActive = getLastActiveEditor(40);
    assert.ok(lastActive);
    assert.strictEqual(lastActive?.uri, primary.document.uri.toString());
  });
});
