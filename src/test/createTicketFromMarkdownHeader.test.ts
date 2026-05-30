import * as assert from "assert";
import * as vscode from "vscode";
import { createTicketFromMarkdownHeader } from "../commands/createTicketFromMarkdownHeader";

const editor = {
  document: {
    uri: vscode.Uri.file("/tmp/task.md"),
    languageId: "markdown",
    getText: () => "content",
  },
} as vscode.TextEditor;

const preview = {
  projectId: 12,
  subject: "Ticket subject",
  tracker: "Task",
  priority: "Normal",
  status: "New",
};

suite("createTicketFromMarkdownHeader command", () => {
  test("missing active editor reports an error", async () => {
    let error: string | undefined;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => undefined,
      previewCreation: () => preview,
      confirmCreation: async () => true,
      createTicket: async () => ({ status: "failed", message: "unexpected" }),
      applyContent: async () => undefined,
      registerTicketDocument: () => undefined,
      showError: (message) => {
        error = message;
      },
      showWarning: () => undefined,
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.strictEqual(error, "No active editor found.");
  });

  test("cancelled confirmation does not create a Redmine ticket", async () => {
    let createCalls = 0;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => editor,
      previewCreation: () => preview,
      confirmCreation: async () => false,
      createTicket: async () => {
        createCalls += 1;
        return { status: "failed", message: "unexpected" };
      },
      applyContent: async () => undefined,
      registerTicketDocument: () => undefined,
      showError: () => undefined,
      showWarning: () => undefined,
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.strictEqual(createCalls, 0);
  });

  test("successful creation updates the document and registers it", async () => {
    let appliedContent: string | undefined;
    let registered: { issueId: number; document: vscode.TextDocument; projectId: number } | undefined;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => editor,
      previewCreation: () => preview,
      confirmCreation: async () => true,
      createTicket: async () => ({
        status: "created",
        issueId: 456,
        updatedContent: "updated",
        preview,
      }),
      applyContent: async (_editor, content) => {
        appliedContent = content;
      },
      registerTicketDocument: (issueId, document, _contentType, projectId) => {
        registered = { issueId, document, projectId: projectId! };
      },
      showError: () => undefined,
      showWarning: () => undefined,
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.strictEqual(appliedContent, "updated");
    assert.deepStrictEqual(registered, {
      issueId: 456,
      document: editor.document,
      projectId: 12,
    });
  });

  test("header update failure warns with the created issue ID and does not register", async () => {
    let warning: string | undefined;
    let registered = false;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => editor,
      previewCreation: () => preview,
      confirmCreation: async () => true,
      createTicket: async () => ({
        status: "created",
        issueId: 456,
        updatedContent: "updated",
        preview,
      }),
      applyContent: async () => {
        throw new Error("write failed");
      },
      registerTicketDocument: () => {
        registered = true;
      },
      showError: () => undefined,
      showWarning: (message) => {
        warning = message;
      },
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.ok(warning?.includes("#456"));
    assert.ok(warning?.includes("issue_id: 456"));
    assert.strictEqual(registered, false);
  });

  test("header generation failure warns with the created issue ID", async () => {
    let warning: string | undefined;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => editor,
      previewCreation: () => preview,
      confirmCreation: async () => true,
      createTicket: async () => ({
        status: "header-update-failed",
        issueId: 456,
        preview,
      }),
      applyContent: async () => undefined,
      registerTicketDocument: () => undefined,
      showError: () => undefined,
      showWarning: (message) => {
        warning = message;
      },
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.ok(warning?.includes("#456"));
    assert.ok(warning?.includes("issue_id: 456"));
  });

  test("failed document save warns with the created issue ID", async () => {
    let warning: string | undefined;
    const dirtyEditor = {
      document: {
        ...editor.document,
        isDirty: true,
        save: async () => false,
      },
    } as unknown as vscode.TextEditor;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => dirtyEditor,
      previewCreation: () => preview,
      confirmCreation: async () => true,
      createTicket: async () => ({
        status: "created",
        issueId: 456,
        updatedContent: "updated",
        preview,
      }),
      applyContent: async () => undefined,
      registerTicketDocument: () => undefined,
      showError: () => undefined,
      showWarning: (message) => {
        warning = message;
      },
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.ok(warning?.includes("#456"));
  });

  test("non-Markdown editor is rejected before preview", async () => {
    let error: string | undefined;
    let previewCalls = 0;
    const textEditor = {
      document: {
        uri: vscode.Uri.file("/tmp/task.txt"),
        languageId: "plaintext",
      },
    } as vscode.TextEditor;

    await createTicketFromMarkdownHeader({
      getActiveEditor: () => textEditor,
      previewCreation: () => {
        previewCalls += 1;
        return preview;
      },
      confirmCreation: async () => true,
      createTicket: async () => ({ status: "failed", message: "unexpected" }),
      applyContent: async () => undefined,
      registerTicketDocument: () => undefined,
      showError: (message) => {
        error = message;
      },
      showWarning: () => undefined,
      showSuccess: () => undefined,
      resolveBaseDir: () => undefined,
    });

    assert.strictEqual(error, "Open a Markdown file before creating a Redmine ticket.");
    assert.strictEqual(previewCalls, 0);
  });
});
