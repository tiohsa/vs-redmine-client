import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildRegisterEditorDocument,
  updateTicketDraftStatusFromDocument,
} from "../app/editorEventController";
import {
  clearRegistry,
  getProjectIdForDocument,
  getTicketIdForDocument,
  NEW_TICKET_DRAFT_ID,
  registerTicketDocument,
} from "../views/ticketEditorRegistry";
import { createDocumentStub, createMutableDocumentStub } from "./helpers/editorStubs";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeDraftStore,
  initializeTicketDraft,
  markDraftStatus,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { releaseSaveSync, suppressSaveSync } from "../views/saveSyncSuppression";

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

const createRegisteredTicketDocument = (ticketId: number, scope: string) => {
  const metadata = buildIssueMetadataFixture();
  const original = buildTicketEditorContent({
    subject: "Original",
    description: "Body",
    metadata,
  });
  const document = createMutableDocumentStub(
    vscode.Uri.parse(`untitled:redmine-client-ticket-${ticketId}.md`),
    original,
  );
  initializeDraftStore(createInMemoryDraftStorage(), scope);
  initializeTicketDraft(ticketId, "Original", "Body", metadata, undefined, scope);
  registerTicketDocument(ticketId, document, "ticket", undefined, scope);
  return { document, metadata, original };
};

suite("editorEventController registerEditorDocument", () => {
  teardown(() => {
    clearRegistry();
    clearTicketDrafts();
    initializeDraftStore(createInMemoryDraftStorage());
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

  test("チケット本文の編集と取り消しを Dirty / Synced に反映する", () => {
    const ticketId = 123;
    const scope = "https://redmine.example/";
    const metadata = buildIssueMetadataFixture();
    const original = buildTicketEditorContent({
      subject: "Original",
      description: "Body",
      metadata,
    });
    const document = createMutableDocumentStub(
      vscode.Uri.parse("untitled:redmine-client-ticket-123.md"),
      original,
    );
    initializeDraftStore(createInMemoryDraftStorage(), scope);
    initializeTicketDraft(ticketId, "Original", "Body", metadata, undefined, scope);
    registerTicketDocument(ticketId, document, "ticket", undefined, scope);

    document.setText(buildTicketEditorContent({
      subject: "Changed",
      description: "Body",
      metadata,
    }));
    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");

    document.setText(original);
    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Synced");
  });

  test("description の末尾改行を Dirty として扱う", () => {
    const ticketId = 125;
    const scope = "test:trailing-newline";
    const { document, original } = createRegisteredTicketDocument(ticketId, scope);

    document.setText(`${original}\n`);

    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");
  });

  test("description の末尾空白を Dirty として扱う", () => {
    const ticketId = 126;
    const scope = "test:trailing-space";
    const { document, metadata } = createRegisteredTicketDocument(ticketId, scope);

    document.setText(buildTicketEditorContent({
      subject: "Original",
      description: "Body ",
      metadata,
    }));

    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");
  });

  test("Conflict 中に編集しても Conflict を維持する", () => {
    const ticketId = 127;
    const scope = "test:conflict-edit";
    const { document, metadata } = createRegisteredTicketDocument(ticketId, scope);
    markDraftStatus(ticketId, "Conflict", scope);
    document.setText(buildTicketEditorContent({
      subject: "Changed",
      description: "Body",
      metadata,
    }));

    assert.strictEqual(updateTicketDraftStatusFromDocument(document), false);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Conflict");
  });

  test("Conflict 中にbaseへ戻しても Conflict を維持する", () => {
    const ticketId = 128;
    const scope = "test:conflict-revert";
    const { document, original } = createRegisteredTicketDocument(ticketId, scope);
    markDraftStatus(ticketId, "Conflict", scope);
    document.setText(original);

    assert.strictEqual(updateTicketDraftStatusFromDocument(document), false);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Conflict");
  });

  for (const status of ["Syncing", "Failed"] as const) {
    test(`${status} 中に編集しても状態を維持する`, () => {
      const ticketId = status === "Syncing" ? 129 : 130;
      const scope = `test:${status.toLowerCase()}-edit`;
      const { document, metadata } = createRegisteredTicketDocument(ticketId, scope);
      markDraftStatus(ticketId, status, scope);
      document.setText(buildTicketEditorContent({
        subject: "Changed",
        description: "Body",
        metadata,
      }));

      assert.strictEqual(updateTicketDraftStatusFromDocument(document), false);
      assert.strictEqual(getTicketDraft(ticketId, scope)?.status, status);
    });
  }

  test("parse error は Synced から Dirty に変更する", () => {
    const ticketId = 131;
    const scope = "test:parse-error";
    const { document } = createRegisteredTicketDocument(ticketId, scope);
    document.setText("---\nissue:");

    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");
  });

  test("同期処理によるドキュメント書き換えでは Synced を Dirty に戻さない", () => {
    const ticketId = 124;
    const scope = "https://redmine.example/";
    const metadata = buildIssueMetadataFixture();
    const uri = vscode.Uri.parse("untitled:redmine-client-ticket-124.md");
    const document = createMutableDocumentStub(
      uri,
      buildTicketEditorContent({ subject: "Original", description: "Body", metadata }),
    );
    initializeDraftStore(createInMemoryDraftStorage(), scope);
    initializeTicketDraft(ticketId, "Original", "Body", metadata, undefined, scope);
    registerTicketDocument(ticketId, document, "ticket", undefined, scope);

    suppressSaveSync(uri.toString());
    try {
      document.setText(buildTicketEditorContent({
        subject: "Canonical",
        description: "Canonical body",
        metadata,
      }));
      assert.strictEqual(updateTicketDraftStatusFromDocument(document), false);
      assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Synced");
    } finally {
      releaseSaveSync(uri.toString());
    }
  });
});
