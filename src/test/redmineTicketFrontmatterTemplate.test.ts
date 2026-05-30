import * as assert from "assert";
import { buildRedmineTicketFrontmatterContent } from "../views/redmineTicketFrontmatterTemplate";

suite("redmineTicketFrontmatterTemplate", () => {
  test("1. Insert into empty Markdown file", () => {
    const result = buildRedmineTicketFrontmatterContent({
      content: "",
      projectId: 123,
    });

    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("mode: new-ticket"));
    assert.ok(result.content.includes("project_id: 123"));
    assert.ok(result.content.includes("# Ticket subject"));
  });

  test("2. Insert into Markdown with existing H1", () => {
    const original = `# Investigate API Timeout

The API response is delayed through the OpenResty route.`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 123,
    });

    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("mode: new-ticket"));
    assert.ok(result.content.includes("project_id: 123"));
    assert.ok(result.content.includes("# Investigate API Timeout"));
    assert.ok(result.content.includes("The API response is delayed through the OpenResty route."));
    // subject placeholderは追加されないはず
    assert.ok(!result.content.includes("# Ticket subject"));
  });

  test("3. Insert into Markdown with body content", () => {
    const original = `The API response is delayed through the OpenResty route.
Database wait time is suspected.`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 123,
    });

    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("mode: new-ticket"));
    assert.ok(result.content.includes("project_id: 123"));
    assert.ok(result.content.includes("# Ticket subject"));
    assert.ok(result.content.includes("The API response is delayed through the OpenResty route."));
    assert.ok(result.content.includes("Database wait time is suspected."));
  });

  test("4. Selected project ID exists", () => {
    const result = buildRedmineTicketFrontmatterContent({
      content: "Hello",
      projectId: 999,
    });
    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("project_id: 999"));
  });

  test("5. No project ID exists", () => {
    const result = buildRedmineTicketFrontmatterContent({
      content: "Hello",
    });
    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("project_id: \n") || result.content.includes("project_id:\n"));
  });

  test("6. Existing Redmine frontmatter without issue_id", () => {
    const original = `---
mode: new-ticket
project_id: 100
issue:
  tracker: Task
  priority: Normal
  status: New
---

# Investigate API Timeout`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 123,
    });

    assert.strictEqual(result.status, "replaceRequired");
    assert.strictEqual(result.message, "Replace existing Redmine ticket frontmatter?");
    assert.ok(result.content.includes("project_id: 123")); // 置換用の新コンテンツで上書きされる
    assert.ok(result.content.includes("# Investigate API Timeout"));
  });

  test("7. Existing Redmine frontmatter with issue_id", () => {
    const original = `---
mode: ticket-update
project_id: 123
issue_id: 456
issue:
  tracker: Task
---

# Existing ticket`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 999,
    });

    assert.strictEqual(result.status, "blocked");
    assert.strictEqual(result.message, "This file is already linked to Redmine ticket #456.");
  });

  test("8. Non-Redmine frontmatter exists", () => {
    const original = `---
title: Meeting Note
tags:
  - redmine
---

# Memo`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 123,
    });

    assert.strictEqual(result.status, "blocked");
    assert.strictEqual(
      result.message,
      "This file already has non-Redmine frontmatter. Insert Redmine frontmatter manually to avoid overwriting existing metadata."
    );
  });

  test("9. Multiple H1 headings", () => {
    const original = `# First Heading

Some body here.

# Second Heading

Another body.`;

    const result = buildRedmineTicketFrontmatterContent({
      content: original,
      projectId: 123,
    });

    assert.strictEqual(result.status, "inserted");
    assert.ok(result.content.includes("# First Heading"));
    assert.ok(result.content.includes("# Second Heading"));
    assert.ok(!result.content.includes("# Ticket subject"));
  });
});
