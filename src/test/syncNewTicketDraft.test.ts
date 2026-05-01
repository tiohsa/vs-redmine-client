import * as assert from "assert";
import * as vscode from "vscode";
import { syncNewTicketDraft } from "../views/ticketSaveSync";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { registerNewTicketDraft, setEditorProjectId } from "../views/ticketEditorRegistry";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import {
  suppressSaveSync,
  releaseSaveSync,
  isSaveSyncSuppressed,
} from "../views/saveSyncSuppression";

const buildNewTicketContent = (
  subject: string,
  body: string,
  overrides: Record<string, unknown> = {},
): string => {
  const metadata = buildIssueMetadataFixture();
  return buildTicketEditorContent({
    subject,
    description: body,
    metadata,
    controlFields: {
      mode: "new-ticket",
      project_id: 12,
      issue_id: null,
      ...overrides,
    },
  });
};

const makeEditorStub = (text: string): {
  editor: vscode.TextEditor & { document: vscode.TextDocument };
  capturedContent: () => string | undefined;
} => {
  let captured: string | undefined;
  const document = {
    uri: vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
    getText: () => text,
  } as vscode.TextDocument;
  const editor = { document } as vscode.TextEditor;
  return {
    editor,
    capturedContent: () => captured,
  };
};

const makeCapturingApply = (
  captured: { content?: string },
): (editor: vscode.TextEditor, content: string) => Promise<void> => {
  return async (_editor, content) => {
    captured.content = content;
  };
};

const defaultDeps = {
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
  listTrackers: async () => [{ id: 2, name: "Task" }],
  listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 2, name: "Task" }],
};

suite("syncNewTicketDraft – editor rewrite", () => {
  setup(() => {
    clearTicketDrafts();
    clearNewTicketDrafts();
  });

  teardown(() => {
    clearTicketDrafts();
    clearNewTicketDrafts();
  });

  test("successful creation rewrites editor with ticket-update mode and issue_id", async () => {
    const text = buildNewTicketContent("My Ticket", "Body text");
    const { editor } = makeEditorStub(text);
    registerNewTicketDraft(editor);
    setEditorProjectId(editor, 12);

    const captured: { content?: string } = {};
    const result = await syncNewTicketDraft({
      editor,
      deps: {
        ...defaultDeps,
        createIssue: async () => 12345,
      },
      applyContent: makeCapturingApply(captured),
    });

    assert.strictEqual(result.status, "created");
    assert.ok(captured.content, "editor content should have been rewritten");

    const parsed = parseTicketEditorContent(captured.content!);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 12345);
    assert.strictEqual(parsed.controlFields?.draft_id, undefined);
    assert.ok(
      typeof parsed.controlFields?.last_synced_at === "string",
      "last_synced_at should be set",
    );
    assert.ok(
      parsed.controlFields!.last_synced_at!.length > 0,
      "last_synced_at should not be empty",
    );
  });

  test("failed creation does not rewrite editor content", async () => {
    const text = buildNewTicketContent("My Ticket", "Body");
    const { editor } = makeEditorStub(text);
    registerNewTicketDraft(editor);
    setEditorProjectId(editor, 12);

    const captured: { content?: string } = {};
    const result = await syncNewTicketDraft({
      editor,
      deps: {
        ...defaultDeps,
        createIssue: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
      },
      applyContent: makeCapturingApply(captured),
    });

    assert.strictEqual(result.status, "unreachable");
    assert.strictEqual(captured.content, undefined, "should not rewrite on failure");
  });

  test("rewritten content retains project_id from original", async () => {
    const text = buildNewTicketContent("Ticket", "Desc");
    const { editor } = makeEditorStub(text);
    registerNewTicketDraft(editor);
    setEditorProjectId(editor, 12);

    const captured: { content?: string } = {};
    await syncNewTicketDraft({
      editor,
      deps: {
        ...defaultDeps,
        createIssue: async () => 42,
      },
      applyContent: makeCapturingApply(captured),
    });

    const parsed = parseTicketEditorContent(captured.content!);
    assert.strictEqual(parsed.controlFields?.project_id, 12);
  });

  test("rewritten content removes issue_id: null placeholder", async () => {
    const text = buildNewTicketContent("T", "D");
    const { editor } = makeEditorStub(text);
    registerNewTicketDraft(editor);
    setEditorProjectId(editor, 12);

    const captured: { content?: string } = {};
    await syncNewTicketDraft({
      editor,
      deps: { ...defaultDeps, createIssue: async () => 777 },
      applyContent: makeCapturingApply(captured),
    });

    const raw = captured.content!;
    assert.ok(!raw.includes("issue_id:  "), "empty issue_id should be gone");
    assert.ok(raw.includes("issue_id: 777"), "numeric issue_id should appear");
  });
});

suite("handleTicketEditorSave – suppression", () => {
  test("isSaveSyncSuppressed returns true while suppressed, false after release", () => {
    const uri = "untitled:test-suppression.md";

    suppressSaveSync(uri);
    assert.strictEqual(isSaveSyncSuppressed(uri), true);

    releaseSaveSync(uri);
    assert.strictEqual(isSaveSyncSuppressed(uri), false);
  });

  test("suppressSaveSync does not affect unrelated URI", () => {
    const uriA = "untitled:a.md";
    const uriB = "untitled:b.md";

    suppressSaveSync(uriA);
    assert.strictEqual(isSaveSyncSuppressed(uriB), false);

    releaseSaveSync(uriA);
  });
});
