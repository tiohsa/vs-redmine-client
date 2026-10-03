import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSyncEngine } from "../app/syncEngine";
import type { DocumentPort } from "../app/ticketSync/ports";
import { createMutableEditorStub } from "./helpers/editorStubs";
import { clearOfflineSyncQueueAsync, addOfflineNewTicketAsync, getOfflineSyncQueue, updateOfflineNewTicketAsync } from "../views/offlineSyncStore";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import {
  buildRegisteredDocumentContent,
  compareAndRewriteDocumentWithRegisteredFields,
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
  test("rewrites content with ticket-update mode and issue_id", async () => {
    const text = buildNewTicketText();
    const result = buildRegisteredDocumentContent(text, 9001);

    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 9001);
    assert.strictEqual(parsed.controlFields?.draft_id, undefined);
    assert.ok(typeof parsed.controlFields?.last_synced_at === "string");
    assert.strictEqual(parsed.controlFields?.project_id, 5);
  });

  test("preserves subject and description", async () => {
    const text = buildNewTicketText();
    const result = buildRegisteredDocumentContent(text, 123);

    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.subject, "Queued ticket");
    assert.strictEqual(parsed.description, "Body");
  });

  test("removes draft_id when present", async () => {
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

suite("syncUnsyncedFileNewTicket – CAS DocumentPort finalization", () => {
  const DOC_URI = "untitled:redmine-client-new-ticket.md";

  test("open documentをexpected snapshotから登録済み内容に更新する", async () => {
    const text = buildNewTicketText();
    const editor = createMutableEditorStub(vscode.Uri.parse(DOC_URI), text);
    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: DOC_URI, ticketId: 4242, projectId: 33,
      replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
      deps: { textDocuments: [editor.document], textEditors: [editor] },
    });
    assert.deepStrictEqual(result, { kind: "applied" });
    const parsed = parseTicketEditorContent(editor.document.getText());
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 4242);
    assert.strictEqual(parsed.controlFields?.project_id, 33);
  });

  test("editor.editが拒否された場合はwrite_failed", async () => {
    const text = buildNewTicketText();
    const editor = createMutableEditorStub(vscode.Uri.parse(DOC_URI), text);
    editor.edit = async () => false;
    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: DOC_URI, ticketId: 1,
      replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
      deps: { textDocuments: [editor.document], textEditors: [editor] },
    });
    assert.deepStrictEqual(result, { kind: "write_failed" });
    assert.strictEqual(editor.document.getText(), text);
  });

  test("document.saveが拒否された場合はsave_failed", async () => {
    const text = buildNewTicketText();
    const editor = createMutableEditorStub(vscode.Uri.parse(DOC_URI), text);
    Object.defineProperty(editor.document, "isDirty", { value: true });
    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: DOC_URI, ticketId: 1,
      replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
      deps: { textDocuments: [editor.document], textEditors: [editor], saveDocument: async () => false },
    });
    assert.deepStrictEqual(result, { kind: "save_failed" });
  });

  test("LF-01: finalization直前のdocument変更はstale_sourceで維持する", async () => {
    const text = buildNewTicketText();
    const newerText = `${text}\nnewer edit`;
    const editor = createMutableEditorStub(vscode.Uri.parse(DOC_URI), text);
    editor.edit = async () => {
      editor.document.setText(newerText);
      return false;
    };
    let saveCalls = 0;
    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: DOC_URI, ticketId: 1,
      replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
      deps: { textDocuments: [editor.document], textEditors: [editor], saveDocument: async () => { saveCalls++; return true; } },
    });
    assert.deepStrictEqual(result, { kind: "stale_source" });
    assert.strictEqual(editor.document.getText(), newerText);
    assert.strictEqual(saveCalls, 0);
  });

  test("expected contentより新しいdocumentにはeditor.editを呼ばない", async () => {
    const text = buildNewTicketText();
    const newerText = `${text}\nnewer edit`;
    const editor = createMutableEditorStub(vscode.Uri.parse(DOC_URI), newerText);
    let editCalls = 0;
    editor.edit = async () => { editCalls++; return true; };
    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: DOC_URI, ticketId: 1,
      replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
      deps: { textDocuments: [editor.document], textEditors: [editor] },
    });
    assert.deepStrictEqual(result, { kind: "stale_source" });
    assert.strictEqual(editCalls, 0);
    assert.strictEqual(editor.document.getText(), newerText);
  });

  test("LF-02: closed documentはnot_availableでfilesystemを上書きしない", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-finalization-"));
    const filePath = path.join(directory, "ticket.md");
    const text = buildNewTicketText();
    fs.writeFileSync(filePath, text);
    try {
      const result = await compareAndRewriteDocumentWithRegisteredFields({
        documentUri: vscode.Uri.file(filePath).toString(), ticketId: 5555,
        replacement: parseTicketEditorContent(text), expected: { content: text, operationRevision: 1 },
        deps: { textDocuments: [], textEditors: [] },
      });
      assert.deepStrictEqual(result, { kind: "not_available" });
      assert.strictEqual(fs.readFileSync(filePath, "utf8"), text);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("SyncEngineはclosed documentのremote identityとlocal_finalize_pendingを保持する", async () => {
    const text = buildNewTicketText();
    await addOfflineNewTicketAsync({ content: text, projectId: 5, documentUri: DOC_URI });
    const documents: DocumentPort = {
      rewriteNewTicket: (input) => compareAndRewriteDocumentWithRegisteredFields({
        ...input, deps: { textDocuments: [], textEditors: [] },
      }),
      rewriteTicket: (input) => compareAndRewriteDocumentWithRegisteredFields({
        ...input, deps: { textDocuments: [], textEditors: [] },
      }),
      findOpenDocument: () => undefined,
    };
    let createCalls = 0;
    const engine = createSyncEngine({ documents, tickets: {
      createIssue: async () => { createCalls++; return 77; },
      getIssueDetail: async () => ({ ticket: {
        id: 77, subject: "Queued ticket", description: "Body", projectId: 5, updatedAt: "t1",
      }, comments: [] }),
      getProjectTrackers: async () => [{ id: 1, name: "Task" }],
      listIssueStatuses: async () => [{ id: 2, name: "In Progress" }],
      listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
    } });
    try {
      const key = { kind: "newTicket" as const, documentUri: DOC_URI };
      const result = await engine.syncOne(key, { connectionScope: "" });
      assert.strictEqual(result.kind, "remote_committed");
      const entry = getOfflineSyncQueue().newTickets.find((item) => item.documentUri === DOC_URI);
      assert.strictEqual(entry?.createdIssueId, 77);
      assert.strictEqual(entry?.phase, "local_finalize_pending");
      assert.strictEqual(entry?.effects?.find((effect) => effect.kind === "ticket_create")?.state, "committed");
      await engine.syncOne(key, { connectionScope: "" });
      assert.strictEqual(createCalls, 1);
      assert.strictEqual(getOfflineSyncQueue().newTickets.find((item) => item.documentUri === DOC_URI)?.phase, "local_finalize_pending");
    } finally {
      await clearOfflineSyncQueueAsync();
      clearTicketDrafts();
    }
  });

});

suite("syncUnsyncedFileNewTicket – project_id preserved in rewrite", () => {
  test("buildRegisteredDocumentContent injects projectId into frontmatter", async () => {
    const text = buildTicketEditorContent({
      subject: "T",
      description: "D",
      metadata: buildIssueMetadataFixture(),
      controlFields: { mode: "new-ticket", issue_id: null },
    });
    const result = buildRegisteredDocumentContent(text, 42, 7);
    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.controlFields?.project_id, 7);
    assert.strictEqual(parsed.controlFields?.issue_id, 42);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
  });

  test("buildRegisteredDocumentContent overrides stale project_id with resolved value", async () => {
    const text = buildTicketEditorContent({
      subject: "T",
      description: "D",
      metadata: buildIssueMetadataFixture(),
      controlFields: { mode: "new-ticket", issue_id: null, project_id: 99 },
    });
    const result = buildRegisteredDocumentContent(text, 10, 55);
    const parsed = parseTicketEditorContent(result);
    assert.strictEqual(parsed.controlFields?.project_id, 55);
  });


});

suite("syncUnsyncedFileNewTicket – updateOfflineNewTicketAsync", () => {
  const DOC_URI_UPD = "file:///tmp/update-test.md";

  setup(async () => {
    await clearOfflineSyncQueueAsync();
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync();
  });

  test("updateOfflineNewTicketAsync sets createdIssueId and status", async () => {
    await addOfflineNewTicketAsync({ content: "# T", documentUri: DOC_URI_UPD, projectId: 5 });
    await updateOfflineNewTicketAsync({ documentUri: DOC_URI_UPD }, { createdIssueId: 123, status: "created_rewrite_failed" });

    const q = getOfflineSyncQueue();
    const entry = q.newTickets.find((t) => t.documentUri === DOC_URI_UPD);
    assert.ok(entry, "entry should exist");
    assert.strictEqual(entry?.createdIssueId, 123);
    assert.strictEqual(entry?.status, "created_rewrite_failed");
    assert.strictEqual(entry?.projectId, 5, "other fields preserved");
  });

  test("updateOfflineNewTicketAsync is no-op when documentUri not found", async () => {
    await addOfflineNewTicketAsync({ content: "# T", documentUri: DOC_URI_UPD });
    await updateOfflineNewTicketAsync({ documentUri: "file:///tmp/nonexistent.md" }, { createdIssueId: 999 });

    const q = getOfflineSyncQueue();
    const entry = q.newTickets.find((t) => t.documentUri === DOC_URI_UPD);
    assert.strictEqual(entry?.createdIssueId, undefined);
  });

  test("queue entry with createdIssueId still exists after failed rewrite (regression)", async () => {
    await addOfflineNewTicketAsync({ content: "# T", documentUri: DOC_URI_UPD });
    await updateOfflineNewTicketAsync({ documentUri: DOC_URI_UPD }, { createdIssueId: 77 });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1, "entry must remain in queue");
    assert.strictEqual(q.newTickets[0].createdIssueId, 77, "createdIssueId must be preserved");
  });
});
