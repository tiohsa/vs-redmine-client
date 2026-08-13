import * as assert from "assert";
import * as vscode from "vscode";
import { createTicketFromMarkdownHeader } from "../commands/createTicketFromMarkdownHeader";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { TicketSyncOutcome } from "../app/ticketSync";

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

type CommandDeps = NonNullable<Parameters<typeof createTicketFromMarkdownHeader>[0]>;

const buildDeps = (overrides: Partial<CommandDeps> = {}): CommandDeps => ({
  getActiveEditor: () => editor,
  previewCreation: () => preview,
  confirmCreation: async () => true,
  syncTicket: async (): Promise<TicketSyncOutcome> => ({
    kind: "failed_before_commit",
    error: new Error("unexpected"),
  }),
  showError: () => undefined,
  showWarning: () => undefined,
  showSuccess: () => undefined,
  resolveBaseDir: () => undefined,
  ...overrides,
});

suite("createTicketFromMarkdownHeader command", () => {
  test("missing active editor reports an error", async () => {
    let error: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      getActiveEditor: () => undefined,
      showError: (message) => { error = message; },
    }));

    assert.strictEqual(error, "No active editor found.");
  });

  test("cancelled confirmation does not invoke ticket sync", async () => {
    let syncCalls = 0;

    await createTicketFromMarkdownHeader(buildDeps({
      confirmCreation: async () => false,
      syncTicket: async () => {
        syncCalls++;
        return { kind: "completed", ticketId: 456 };
      },
    }));

    assert.strictEqual(syncCalls, 0);
  });

  test("successful creation delegates the operation to TicketSyncService", async () => {
    let receivedProjectId: number | undefined;
    let receivedScope: string | undefined;
    let success: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      syncTicket: async (input) => {
        receivedProjectId = input.projectId;
        receivedScope = input.connectionScope;
        return { kind: "completed", ticketId: 456 };
      },
      showSuccess: (message) => { success = message; },
    }));

    assert.strictEqual(receivedProjectId, 12);
    assert.strictEqual(receivedScope, getCurrentConnectionScope());
    assert.ok(success?.includes("#456"));
  });

  test("非同期同期中も開始時の接続スコープを service へ渡す", async () => {
    const operationScope = getCurrentConnectionScope();
    let observedScope: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      syncTicket: async (input) => {
        await Promise.resolve();
        observedScope = input.connectionScope;
        return { kind: "completed", ticketId: 789 };
      },
    }));

    assert.strictEqual(observedScope, operationScope);
  });

  test("remote commit 後の local finalize pending は作成済み ID を警告する", async () => {
    let warning: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      syncTicket: async () => ({
        kind: "remote_committed",
        ticketId: 456,
        pending: "local_finalize",
      }),
      showWarning: (message) => { warning = message; },
    }));

    assert.ok(warning?.includes("#456"));
    assert.ok(warning?.includes("issue_id: 456"));
  });

  test("remote commit 前の failure は error として表示する", async () => {
    let error: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      syncTicket: async () => ({
        kind: "failed_before_commit",
        error: new Error("Invalid metadata."),
      }),
      showError: (message) => { error = message; },
    }));

    assert.strictEqual(error, "Invalid metadata.");
  });

  test("service の予期しない例外を command error として表示する", async () => {
    let error: string | undefined;

    await createTicketFromMarkdownHeader(buildDeps({
      syncTicket: async () => { throw new Error("service failed"); },
      showError: (message) => { error = message; },
    }));

    assert.strictEqual(error, "service failed");
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

    await createTicketFromMarkdownHeader(buildDeps({
      getActiveEditor: () => textEditor,
      previewCreation: () => {
        previewCalls++;
        return preview;
      },
      showError: (message) => { error = message; },
    }));

    assert.strictEqual(error, "Open a Markdown file before creating a Redmine ticket.");
    assert.strictEqual(previewCalls, 0);
  });
});
