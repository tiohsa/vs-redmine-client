import * as assert from "assert";
import { previewMarkdownTicketCreation } from "../views/markdownTicketCreateService";

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

});
