import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  needsPrimaryEditor,
  registerTicketEditor,
  removeTicketEditorByUri,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

suite("Ticket editor closure", () => {
  teardown(() => {
    clearRegistry();
  });

  test("requires new primary when dedicated editor is closed", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-closed"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-closed-extra"), "");

    registerTicketEditor(20, primary, "primary", "ticket");
    registerTicketEditor(20, extra, "extra", "ticket");

    removeTicketEditorByUri(primary.document.uri);

    assert.strictEqual(needsPrimaryEditor(20), true);
  });
});
