import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import {
  buildTicketPreviewContent,
  findEmptySubjectPosition,
  resolveTicketEditorUri,
  resolveEditorStorageDir,
  ensureScopedEditorFile,
  withTrailingEditLines,
} from "../views/ticketPreview";
import { getConnectionScopeHash } from "../config/connectionScope";

suite("Ticket preview", () => {
  test("renders subject and description", () => {
    const content = buildTicketPreviewContent({
      subject: "Sample ticket",
      description: "Details",
      trackerName: "Task",
      priorityName: "Normal",
      statusName: "In Progress",
      dueDate: "2025-12-31",
    });

    assert.ok(content.includes("Sample ticket"));
    assert.ok(content.includes("Details"));
    assert.ok(content.includes("issue:"));
  });

  test("ticket-update editor content includes mode, project_id, and issue_id control fields", () => {
    const { buildTicketEditorContent } = require("../views/ticketEditorContent");
    const content: string = buildTicketEditorContent({
      subject: "Existing ticket",
      description: "Body",
      metadata: {
        tracker: "Task",
        priority: "Normal",
        status: "In Progress",
        due_date: "",
        start_date: "",
      },
      controlFields: {
        mode: "ticket-update",
        project_id: 5,
        issue_id: 42,
      },
    });

    assert.ok(content.includes("mode: ticket-update"), "should include mode");
    assert.ok(content.includes("project_id: 5"), "should include project_id");
    assert.ok(content.includes("issue_id: 42"), "should include issue_id");
  });

  test("renders start_date in ticket file metadata", () => {
    const content = buildTicketPreviewContent({
      subject: "Sample ticket",
      description: "Details",
      trackerName: "Task",
      priorityName: "Normal",
      statusName: "In Progress",
      dueDate: "2025-12-31",
      startDate: "2025-12-01",
    });

    assert.ok(content.includes("  start_date: 2025-12-01"));
  });

  test("renders empty start_date in ticket file metadata", () => {
    const content = buildTicketPreviewContent({
      subject: "Sample ticket",
      description: "Details",
      trackerName: "Task",
      priorityName: "Normal",
      statusName: "In Progress",
      dueDate: "2025-12-31",
    });

    assert.ok(content.includes("  start_date: "));
  });

  test("appends trailing blank lines for editing", () => {
    assert.strictEqual(withTrailingEditLines("Line"), "Line\n\n");
    assert.strictEqual(withTrailingEditLines("Line\n"), "Line\n\n");
    assert.strictEqual(withTrailingEditLines("Line\n\n"), "Line\n\n");
  });

  test("resolves stable editor uri for the same ticket", () => {
    const ticket = { id: 12, subject: "Sample", projectId: 5 };
    const storageDir = vscode.Uri.parse("file:/storage");

    const first = resolveTicketEditorUri({
      ticket,
      kind: "primary",
      storageDir,
    });
    const second = resolveTicketEditorUri({
      ticket,
      kind: "primary",
      storageDir,
    });

    assert.strictEqual(first.toString(), second.toString());
  });

  test("uses configured storage directory when valid", () => {
    const resolution = resolveEditorStorageDir({
      configuredPath: process.cwd(),
    });

    assert.strictEqual(resolution.usedFallback, false);
    assert.ok(resolution.uri);
  });

  test("falls back when configured path is relative", () => {
    const workspace = [{ uri: vscode.Uri.parse("file:/workspace") }] as vscode.WorkspaceFolder[];
    const resolution = resolveEditorStorageDir({
      configuredPath: "relative/path",
      workspaceFolders: workspace,
    });

    assert.strictEqual(resolution.usedFallback, true);
    assert.ok(resolution.errorMessage);
    assert.strictEqual(
      resolution.uri?.toString(),
      vscode.Uri.joinPath(workspace[0].uri, ".redmine-client", "editors").toString(),
    );
  });

  test("falls back when configured path does not exist", () => {
    const workspace = [{ uri: vscode.Uri.parse("file:/workspace") }] as vscode.WorkspaceFolder[];
    const resolution = resolveEditorStorageDir({
      configuredPath: "/path/does/not/exist",
      workspaceFolders: workspace,
    });

    assert.strictEqual(resolution.usedFallback, true);
    assert.ok(resolution.errorMessage);
  });

  test("returns undefined storage when no workspace is available", () => {
    const resolution = resolveEditorStorageDir({
      configuredPath: "",
      workspaceFolders: [],
    });

    assert.strictEqual(resolution.usedFallback, true);
    assert.strictEqual(resolution.uri, undefined);
  });

  test("編集ファイル保存先へ接続スコープハッシュを付与する", () => {
    const scope = "https://example.com/redmine/";
    const workspace = [{ uri: vscode.Uri.parse("file:/workspace") }] as vscode.WorkspaceFolder[];
    const resolution = resolveEditorStorageDir({
      configuredPath: "",
      workspaceFolders: workspace,
      connectionScope: scope,
    });

    assert.strictEqual(
      resolution.uri?.toString(),
      vscode.Uri.joinPath(
        workspace[0].uri,
        ".redmine-client",
        "editors",
        getConnectionScopeHash(scope),
      ).toString(),
    );
    assert.strictEqual(
      resolution.legacyUri?.toString(),
      vscode.Uri.joinPath(workspace[0].uri, ".redmine-client", "editors").toString(),
    );
  });

  test("旧形式編集ファイルを内容を保持したままスコープ別保存先へ移行する", async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `redmine-editor-${Date.now()}-${Math.random()}`));
    const scopedDir = vscode.Uri.joinPath(root, "0123456789abcdef");
    const legacyFile = vscode.Uri.joinPath(root, "ticket-1.md");
    const scopedFile = vscode.Uri.joinPath(scopedDir, "ticket-1.md");
    try {
      await vscode.workspace.fs.createDirectory(scopedDir);
      await vscode.workspace.fs.writeFile(legacyFile, new TextEncoder().encode("unsaved draft"));

      await ensureScopedEditorFile({
        fileUri: scopedFile,
        legacyFileUri: legacyFile,
        initialContent: "server value",
      });

      const migrated = new TextDecoder().decode(await vscode.workspace.fs.readFile(scopedFile));
      assert.strictEqual(migrated, "unsaved draft");
      await assert.rejects(() => Promise.resolve(vscode.workspace.fs.stat(legacyFile)));
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test("locates the empty subject placeholder position", () => {
    const content = [
      "---",
      "issue:",
      "  tracker: Task",
      "  priority: Normal",
      "  status: New",
      "  due_date: 2025-01-01",
      "---",
      "",
      "# ",
      "",
    ].join("\n");

    const position = findEmptySubjectPosition(content);
    assert.deepStrictEqual(position, { line: 8, character: 2 });
  });
});
