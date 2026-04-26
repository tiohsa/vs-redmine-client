import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  registerNewTicketDraft,
  removeTicketEditorByUri,
} from "../views/ticketEditorRegistry";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { clearTicketDrafts } from "../views/ticketDraftStore";

const buildNewTicketText = (): string =>
  buildTicketEditorContent({
    subject: "Draft",
    description: "Body",
    metadata: buildIssueMetadataFixture(),
    controlFields: { mode: "new-ticket", issue_id: null },
  });


const makeEditorWith = (uri: vscode.Uri, text: string): vscode.TextEditor => {
  const document = { uri, getText: () => text } as vscode.TextDocument;
  return { document } as vscode.TextEditor;
};

suite("openNewTicketDraft – reuse prevention after sync", () => {
  setup(() => {
    clearRegistry();
    clearTicketDrafts();
  });

  teardown(() => {
    clearRegistry();
    clearTicketDrafts();
  });

  test("removeTicketEditorByUri cleans up NEW_TICKET_DRAFT_ID entry", () => {
    const uri = vscode.Uri.parse("untitled:redmine-client-new-ticket.md");
    const editor = makeEditorWith(uri, buildNewTicketText());
    registerNewTicketDraft(editor);

    removeTicketEditorByUri(uri);

    const { getNewTicketDraftUri } = require("../views/ticketEditorRegistry") as typeof import("../views/ticketEditorRegistry");
    assert.strictEqual(
      getNewTicketDraftUri(),
      undefined,
      "registry entry should be removed after removeTicketEditorByUri",
    );
  });

  test("after syncUnsyncedFile-style registration, getNewTicketDraftUri returns undefined", () => {
    const uri = vscode.Uri.parse("untitled:redmine-client-new-ticket.md");
    const editor = makeEditorWith(uri, buildNewTicketText());
    const document = editor.document;

    registerNewTicketDraft(editor);

    // Simulate syncUnsyncedFile: clean up old entry, register with new ticketId
    removeTicketEditorByUri(uri);
    const { registerTicketDocument, getNewTicketDraftUri } = require("../views/ticketEditorRegistry") as typeof import("../views/ticketEditorRegistry");
    registerTicketDocument(12345, document, "ticket", 5);

    assert.strictEqual(
      getNewTicketDraftUri(),
      undefined,
      "getNewTicketDraftUri should be undefined after registry cleanup",
    );
  });

  test("without removeTicketEditorByUri, getNewTicketDraftUri returns stale URI (pre-fix behavior)", () => {
    const uri = vscode.Uri.parse("untitled:redmine-client-new-ticket-stale.md");
    const editor = makeEditorWith(uri, buildNewTicketText());
    const document = editor.document;

    registerNewTicketDraft(editor);

    // Without cleanup (old behavior)
    const { registerTicketDocument, getNewTicketDraftUri } = require("../views/ticketEditorRegistry") as typeof import("../views/ticketEditorRegistry");
    registerTicketDocument(99999, document, "ticket", 5);

    // The URI is still in editorsByTicket[-1] – stale reference
    const result = getNewTicketDraftUri();
    // This demonstrates the bug: result is not undefined
    assert.ok(
      result !== undefined,
      "without cleanup, stale URI is still returned (demonstrating the bug)",
    );
  });
});
