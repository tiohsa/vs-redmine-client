import * as assert from "assert";
import * as fs from "fs";
import { createTicketFromMarkdownContent, previewMarkdownTicketCreation } from "../views/markdownTicketCreateService";
import { createTempImage } from "./helpers/markdownImageTestUtils";

const buildContent = (
  control = "mode: new-ticket\nproject_id: 12",
  body = "Body text.",
): string => `---
${control}
issue:
  tracker: Task
  priority: Normal
  status: New
  due_date:
---

# Markdown ticket

${body}
`;

const createDeps = {
  createIssue: async () => 456,
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "New" }],
  listTrackers: async () => [{ id: 2, name: "Task" }],
  listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "token", filename: "image.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 2, name: "Task" }],
};

suite("markdownTicketCreateService", () => {
  test("preview uses project_id from the Markdown header", () => {
    const preview = previewMarkdownTicketCreation(buildContent(), {
      getSelectedProjectId: () => 20,
      getDefaultProjectId: () => "30",
    });

    assert.strictEqual(preview.projectId, 12);
    assert.strictEqual(preview.subject, "Markdown ticket");
    assert.strictEqual(preview.tracker, "Task");
    assert.strictEqual(preview.priority, "Normal");
    assert.strictEqual(preview.status, "New");
  });

  test("preview falls back to the selected project and then default project", () => {
    const selected = previewMarkdownTicketCreation(buildContent("mode: new-ticket"), {
      getSelectedProjectId: () => 20,
      getDefaultProjectId: () => "30",
    });
    const fallback = previewMarkdownTicketCreation(buildContent("mode: new-ticket"), {
      getSelectedProjectId: () => undefined,
      getDefaultProjectId: () => "30",
    });

    assert.strictEqual(selected.projectId, 20);
    assert.strictEqual(fallback.projectId, 30);
  });

  test("creation uses the header project, subject, and body and returns updated content", async () => {
    let createdInput: { projectId: number; subject: string; description: string } | undefined;
    const result = await createTicketFromMarkdownContent({
      content: buildContent(),
      deps: {
        ...createDeps,
        createIssue: async (input) => {
          createdInput = input;
          return 456;
        },
      },
      now: () => new Date("2026-05-31T10:30:00.000Z"),
    });

    assert.strictEqual(result.status, "created");
    assert.deepStrictEqual(createdInput && {
      projectId: createdInput.projectId,
      subject: createdInput.subject,
      description: createdInput.description,
    }, {
      projectId: 12,
      subject: "Markdown ticket",
      description: "Body text.\n",
    });
    if (result.status === "created") {
      assert.ok(result.updatedContent.includes("mode: ticket-update"));
      assert.ok(result.updatedContent.includes("issue_id: 456"));
      assert.ok(result.updatedContent.includes("last_synced_at: 2026-05-31T10:30:00.000Z"));
    }
  });

  test("duplicate issue_id is rejected before Redmine creation", async () => {
    let createCalls = 0;
    const result = await createTicketFromMarkdownContent({
      content: buildContent("mode: new-ticket\nissue_id: 99"),
      deps: {
        ...createDeps,
        createIssue: async () => {
          createCalls += 1;
          return 456;
        },
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.message, "Already linked to Redmine ticket #99.");
    assert.strictEqual(createCalls, 0);
  });

  test("creation preserves the existing Markdown image upload rewrite", async () => {
    const temp = createTempImage();
    try {
      const result = await createTicketFromMarkdownContent({
        content: buildContent(undefined, "![img](./image.png)"),
        baseDir: temp.dir,
        deps: {
          ...createDeps,
          uploadFile: async () => ({
            token: "token",
            filename: "uploaded.png",
            contentType: "image/png",
          }),
        },
      });

      assert.strictEqual(result.status, "created");
      if (result.status === "created") {
        assert.ok(result.updatedContent.includes("![img](uploaded.png)"));
      }
    } finally {
      fs.rmSync(temp.dir, { recursive: true, force: true });
    }
  });

  test("Redmine failure returns failed without updated content", async () => {
    const result = await createTicketFromMarkdownContent({
      content: buildContent(),
      deps: {
        ...createDeps,
        createIssue: async () => {
          throw new Error("Redmine failed");
        },
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.strictEqual("updatedContent" in result, false);
  });
});
