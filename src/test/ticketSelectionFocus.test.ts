import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  getLastActiveEditor,
  markEditorActive,
  registerTicketEditor,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Ticket selection focus", () => {
  teardown(() => {
    clearRegistry();
  });

  test("focuses the last active editor when multiple exist", async () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-focus"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-focus-extra"), "");

    registerTicketEditor(10, primary, "primary", "ticket");
    registerTicketEditor(10, extra, "extra", "ticket");

    markEditorActive(primary);
    await new Promise((resolve) => setTimeout(resolve, 5));
    markEditorActive(extra);

    const lastActive = getLastActiveEditor(10);
    assert.ok(lastActive);
    assert.strictEqual(lastActive?.uri, extra.document.uri.toString());
  });
});
