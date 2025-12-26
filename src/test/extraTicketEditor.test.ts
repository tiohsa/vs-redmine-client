import * as assert from "assert";
import * as vscode from "vscode";
import { clearRegistry, getTicketEditors, registerTicketEditor } from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Extra ticket editors", () => {
  teardown(() => {
    clearRegistry();
  });

  test("supports multiple extra editors per ticket", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-extra"), "");
    const extraOne = createEditorStub(vscode.Uri.parse("untitled:ticket-extra-1"), "");
    const extraTwo = createEditorStub(vscode.Uri.parse("untitled:ticket-extra-2"), "");

    registerTicketEditor(30, primary, "primary", "ticket");
    registerTicketEditor(30, extraOne, "extra", "ticket");
    registerTicketEditor(30, extraTwo, "extra", "ticket");

    assert.strictEqual(getTicketEditors(30).length, 3);
  });
});
