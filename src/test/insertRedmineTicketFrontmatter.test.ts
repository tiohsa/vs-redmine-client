import * as assert from "assert";
import * as vscode from "vscode";
import { insertRedmineTicketFrontmatter, InsertFrontmatterDeps } from "../commands/insertRedmineTicketFrontmatter";

const createMockEditor = (content: string, languageId = "markdown", pathStr = "/tmp/task.md"): vscode.TextEditor => {
  return {
    document: {
      uri: vscode.Uri.file(pathStr),
      languageId,
      getText: () => content,
    },
  } as unknown as vscode.TextEditor;
};

const createMockDeps = (overrides: Partial<InsertFrontmatterDeps> = {}): InsertFrontmatterDeps => {
  return {
    getActiveEditor: () => createMockEditor(""),
    getProjectSelection: () => ({ id: 123 }),
    getDefaultProjectId: () => "456",
    getTicketEditorDefaults: () => ({
      subject: "",
      description: "",
      metadata: {
        tracker: "Task",
        priority: "Normal",
        status: "New",
        start_date: "",
        due_date: "",
        children: [],
      },
    }),
    buildFrontmatterContent: (input) => {
      return {
        status: "inserted",
        content: `---
mode: new-ticket
project_id: ${input.projectId ?? ""}
issue:
  tracker:   ${input.tracker ?? ""}
  priority:  ${input.priority ?? ""}
  status:    ${input.status ?? ""}
---

# Ticket subject

${input.content}`,
      };
    },
    applyContent: async () => undefined,
    showError: () => undefined,
    showWarning: () => undefined,
    showSuccess: () => undefined,
    confirmReplacement: async () => true,
    ...overrides,
  };
};

suite("insertRedmineTicketFrontmatter command", () => {
  test("missing active editor reports an error", async () => {
    let error: string | undefined;

    const deps = createMockDeps({
      getActiveEditor: () => undefined,
      showError: (msg) => {
        error = msg;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(error, "Open a Markdown file before inserting Redmine ticket frontmatter.");
  });

  test("non-markdown editor reports an error", async () => {
    let error: string | undefined;

    const deps = createMockDeps({
      getActiveEditor: () => createMockEditor("", "plaintext", "/tmp/task.txt"),
      showError: (msg) => {
        error = msg;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(error, "Open a Markdown file before inserting Redmine ticket frontmatter.");
  });

  test("successful insertion of frontmatter", async () => {
    let appliedContent: string | undefined;
    let successMessage: string | undefined;

    const deps = createMockDeps({
      getActiveEditor: () => createMockEditor("Hello World"),
      applyContent: async (_editor, content) => {
        appliedContent = content;
      },
      showSuccess: (msg) => {
        successMessage = msg;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.ok(appliedContent?.includes("project_id: 123"));
    assert.ok(appliedContent?.includes("tracker:   Task"));
    assert.ok(appliedContent?.includes("Hello World"));
    assert.strictEqual(successMessage, "Redmine ticket frontmatter inserted.");
  });

  test("project ID resolved from default project ID when no selected project exists", async () => {
    let resolvedProjectId: number | undefined;

    const deps = createMockDeps({
      getProjectSelection: () => ({ id: undefined }),
      getDefaultProjectId: () => "456",
      buildFrontmatterContent: (input) => {
        resolvedProjectId = input.projectId;
        return { status: "inserted", content: "" };
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(resolvedProjectId, 456);
  });

  test("replacement confirmation - user chooses Replace", async () => {
    let appliedContent: string | undefined;
    let confirmCalled = false;

    const deps = createMockDeps({
      buildFrontmatterContent: () => {
        return {
          status: "replaceRequired",
          content: "replaced content",
          message: "Replace existing Redmine ticket frontmatter?",
        };
      },
      confirmReplacement: async (msg) => {
        confirmCalled = true;
        assert.strictEqual(msg, "Replace existing Redmine ticket frontmatter?");
        return true;
      },
      applyContent: async (_editor, content) => {
        appliedContent = content;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(confirmCalled, true);
    assert.strictEqual(appliedContent, "replaced content");
  });

  test("replacement confirmation - user cancels", async () => {
    let appliedContent: string | undefined;
    let confirmCalled = false;

    const deps = createMockDeps({
      buildFrontmatterContent: () => {
        return {
          status: "replaceRequired",
          content: "replaced content",
          message: "Replace existing Redmine ticket frontmatter?",
        };
      },
      confirmReplacement: async () => {
        confirmCalled = true;
        return false;
      },
      applyContent: async (_editor, content) => {
        appliedContent = content;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(confirmCalled, true);
    assert.strictEqual(appliedContent, undefined);
  });

  test("blocked replacement (e.g., existing issue_id)", async () => {
    let errorMsg: string | undefined;

    const deps = createMockDeps({
      buildFrontmatterContent: () => {
        return {
          status: "blocked",
          message: "This file is already linked to Redmine ticket #456.",
        };
      },
      showError: (msg) => {
        errorMsg = msg;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(errorMsg, "This file is already linked to Redmine ticket #456.");
  });

  test("blocked due to non-Redmine frontmatter", async () => {
    let errorMsg: string | undefined;

    const deps = createMockDeps({
      buildFrontmatterContent: () => {
        return {
          status: "blocked",
          message: "This file already has non-Redmine frontmatter. Insert Redmine frontmatter manually to avoid overwriting existing metadata.",
        };
      },
      showError: (msg) => {
        errorMsg = msg;
      },
    });

    await insertRedmineTicketFrontmatter(deps);

    assert.strictEqual(
      errorMsg,
      "This file already has non-Redmine frontmatter. Insert Redmine frontmatter manually to avoid overwriting existing metadata."
    );
  });
});
