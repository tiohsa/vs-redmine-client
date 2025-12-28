import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildTicketPreviewContent,
  findEmptySubjectPosition,
  resolveTicketEditorUri,
  resolveEditorStorageDir,
  resolveNewTicketDraftContent,
  withTrailingEditLines,
} from "../views/ticketPreview";

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
      vscode.Uri.joinPath(workspace[0].uri, ".todoex", "editors").toString(),
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

  test("uses template content for new ticket drafts when configured", () => {
    const template = [
      "---",
      "issue:",
      "  tracker: Task",
      "  priority: Normal",
      "  status: New",
      "  due_date: 2025-01-01",
      "---",
      "",
      "# Template subject",
      "",
      "Template body",
    ].join("\n");

    const resolution = resolveNewTicketDraftContent({
      templatePath: "/abs/template.md",
      existsSync: () => true,
      readFileSync: () => template,
    });

    assert.strictEqual(resolution.usedTemplate, true);
    assert.strictEqual(resolution.isTemplateConfigured, true);
    assert.strictEqual(resolution.content.subject, "Template subject");
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
