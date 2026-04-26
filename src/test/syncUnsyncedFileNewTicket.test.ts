import * as assert from "assert";
import * as vscode from "vscode";
import { clearOfflineSyncQueue, addOfflineNewTicket, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import {
  buildRegisteredDocumentContent,
  rewriteDocumentWithRegisteredFields,
} from "../views/editorDocumentRewrite";

const buildNewTicketText = (): string =>
  buildTicketEditorContent({
    subject: "Queued ticket",
    description: "Body",
    metadata: buildIssueMetadataFixture(),
    controlFields: {
      mode: "new-ticket",
      project_id: 5,
      issue_id: null,
    },
  });

suite("syncUnsyncedFileNewTicket – buildRegisteredDocumentContent", () => {
  test("rewrites content with ticket-update mode and issue_id", () => {
    const text = buildNewTicketText();
    const result = buildRegisteredDocumentContent(text, 9001);

    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 9001);
    assert.strictEqual(parsed.controlFields?.draft_id, undefined);
    assert.ok(typeof parsed.controlFields?.last_synced_at === "string");
    assert.strictEqual(parsed.controlFields?.project_id, 5);
  });

  test("preserves subject and description", () => {
    const text = buildNewTicketText();
    const result = buildRegisteredDocumentContent(text, 123);

    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.subject, "Queued ticket");
    assert.strictEqual(parsed.description, "Body");
  });

  test("removes draft_id when present", () => {
    const text = buildTicketEditorContent({
      subject: "T",
      description: "D",
      metadata: buildIssueMetadataFixture(),
      controlFields: {
        mode: "new-ticket",
        issue_id: null,
        draft_id: "some-uuid",
      },
    });
    const result = buildRegisteredDocumentContent(text, 1);
    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.controlFields?.draft_id, undefined);
  });
});

suite("syncUnsyncedFileNewTicket – rewriteDocumentWithRegisteredFields open document", () => {
  const DOC_URI = "untitled:redmine-client-new-ticket.md";

  test("rewrites open document via applyEdit and returns true", async () => {
    const text = buildNewTicketText();
    const openDocument = {
      uri: vscode.Uri.parse(DOC_URI),
      getText: () => text,
    } as vscode.TextDocument;

    let appliedContent: string | undefined;
    const rewriteDeps = {
      textDocuments: [openDocument],
      applyEdit: async (edit: vscode.WorkspaceEdit) => {
        const entries = edit.entries();
        if (entries.length > 0) {
          appliedContent = entries[0][1][0].newText;
        }
        return true;
      },
    };

    const success = await rewriteDocumentWithRegisteredFields(DOC_URI, 4242, rewriteDeps);

    assert.strictEqual(success, true);
    assert.ok(appliedContent, "content should have been applied");
    const parsed = parseTicketEditorContent(appliedContent!);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 4242);
  });

  test("applyEdit failure returns false", async () => {
    const text = buildNewTicketText();
    const openDocument = {
      uri: vscode.Uri.parse(DOC_URI),
      getText: () => text,
    } as vscode.TextDocument;

    const rewriteDeps = {
      textDocuments: [openDocument],
      applyEdit: async () => false,
    };

    const success = await rewriteDocumentWithRegisteredFields(DOC_URI, 1, rewriteDeps);
    assert.strictEqual(success, false);
  });
});

suite("syncUnsyncedFileNewTicket – rewriteDocumentWithRegisteredFields closed file", () => {
  test("rewrites closed file URI via writeFile and returns true", async () => {
    const text = buildNewTicketText();
    const fileUri = vscode.Uri.file("/tmp/redmine-client-new-ticket-test.md");
    let writtenContent: string | undefined;

    const rewriteDeps = {
      textDocuments: [],
      readFile: async () => Buffer.from(text, "utf8") as unknown as Uint8Array,
      writeFile: async (_uri: vscode.Uri, content: Uint8Array) => {
        writtenContent = Buffer.from(content).toString("utf8");
      },
    };

    const success = await rewriteDocumentWithRegisteredFields(
      fileUri.toString(),
      5555,
      rewriteDeps,
    );

    assert.strictEqual(success, true);
    assert.ok(writtenContent, "file should have been written");
    const parsed = parseTicketEditorContent(writtenContent!);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 5555);
  });

  test("returns false for untitled: scheme when document not open", async () => {
    const rewriteDeps = { textDocuments: [] };

    const success = await rewriteDocumentWithRegisteredFields(
      "untitled:some-file.md",
      1,
      rewriteDeps,
    );

    assert.strictEqual(success, false);
  });
});

suite("syncUnsyncedFileNewTicket – queue management", () => {
  const DOC_URI = "untitled:redmine-client-new-ticket-queue.md";

  setup(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
  });

  teardown(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
  });

  test("queue entry remains when rewrite fails", async () => {
    const text = buildNewTicketText();
    addOfflineNewTicket({ content: text, projectId: 5, documentUri: DOC_URI });

    const openDocument = {
      uri: vscode.Uri.parse(DOC_URI),
      getText: () => text,
    } as vscode.TextDocument;

    const rewriteDeps = {
      textDocuments: [openDocument],
      applyEdit: async () => false,
    };

    const success = await rewriteDocumentWithRegisteredFields(DOC_URI, 1, rewriteDeps);
    assert.strictEqual(success, false);

    const queue = getOfflineSyncQueue();
    assert.strictEqual(queue.newTickets.length, 1, "entry should still be in queue");
  });
});
