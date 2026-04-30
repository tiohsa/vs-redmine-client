import * as assert from "assert";
import * as vscode from "vscode";
import { buildRegisterEditorDocument } from "../app/editorEventController";
import {
  clearRegistry,
  getProjectIdForDocument,
  getTicketIdForDocument,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import { createDocumentStub } from "./helpers/editorStubs";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const buildSyncedNewTicketDraftText = (issueId: number, projectId?: number): string =>
  buildTicketEditorContent({
    subject: "Created Ticket",
    description: "Body",
    metadata: buildIssueMetadataFixture(),
    controlFields: {
      mode: "ticket-update",
      issue_id: issueId,
      ...(projectId !== undefined ? { project_id: projectId } : {}),
    },
  });

suite("editorEventController registerEditorDocument", () => {
  teardown(() => {
    clearRegistry();
  });

  test("新規チケット名でも ticket-update の issue_id を優先して既存チケット登録する", () => {
    const registerEditorDocument = buildRegisterEditorDocument();
    const document = createDocumentStub(
      vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
      buildSyncedNewTicketDraftText(12345, 12),
    );

    registerEditorDocument(document);

    assert.strictEqual(getTicketIdForDocument(document), 12345);
    assert.strictEqual(getProjectIdForDocument(document), 12);
  });

  test("issue_id が不正な場合は従来どおり NEW_TICKET_DRAFT_ID として登録する", () => {
    const registerEditorDocument = buildRegisterEditorDocument();
    const document = createDocumentStub(
      vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
      buildTicketEditorContent({
        subject: "Draft",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
        controlFields: {
          mode: "ticket-update",
          issue_id: null,
        },
      }),
    );

    registerEditorDocument(document);

    assert.strictEqual(getTicketIdForDocument(document), NEW_TICKET_DRAFT_ID);
  });
});
