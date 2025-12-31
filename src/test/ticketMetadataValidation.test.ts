import * as assert from "assert";
import { parseIssueMetadataYaml } from "../views/ticketMetadataYaml";

suite("Ticket metadata validation", () => {
  test("rejects missing issue block", () => {
    assert.throws(
      () => parseIssueMetadataYaml("tracker: Task"),
      /issue/,
    );
  });

  test("rejects missing required keys", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          ["issue:", "  tracker: Task", "  priority: Normal"].join("\n"),
        ),
      /Missing metadata key/,
    );
  });

  test("rejects duplicate keys", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
          ].join("\n"),
        ),
      /Duplicate metadata key/,
    );
  });

  test("rejects invalid due_date format", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: tomorrow",
          ].join("\n"),
        ),
      /due_date/,
    );
  });

  test("allows empty due_date", () => {
    const parsed = parseIssueMetadataYaml(
      [
        "issue:",
        "  tracker: Task",
        "  priority: Normal",
        "  status: In Progress",
        "  due_date:",
      ].join("\n"),
    );

    assert.strictEqual(parsed.due_date, "");
  });

  test("allows numeric parent", () => {
    const parsed = parseIssueMetadataYaml(
      [
        "issue:",
        "  tracker: Task",
        "  priority: Normal",
        "  status: In Progress",
        "  due_date: 2025-12-31",
        "  parent: 123",
      ].join("\n"),
    );

    assert.strictEqual(parsed.parent, 123);
  });

  test("rejects non-numeric parent", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  parent: ABC",
          ].join("\n"),
        ),
      /parent must be a numeric ID/,
    );
  });

  test("allows children list", () => {
    const parsed = parseIssueMetadataYaml(
      [
        "issue:",
        "  tracker: Task",
        "  priority: Normal",
        "  status: In Progress",
        "  due_date: 2025-12-31",
        "  children:",
        "    - Child task 1",
        "    - Child task 2",
      ].join("\n"),
    );

    assert.deepStrictEqual(parsed.children, ["Child task 1", "Child task 2"]);
  });

  test("rejects children inline values", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  children: Child task 1",
          ].join("\n"),
        ),
      /children must be a list/,
    );
  });

  test("rejects empty children entries", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  children:",
            "    - ",
          ].join("\n"),
        ),
      /children entries cannot be empty/,
    );
  });

  test("rejects children over the limit", () => {
    const children = Array.from({ length: 51 }, (_, index) => `Child ${index + 1}`);
    const parsed = [
      "issue:",
      "  tracker: Task",
      "  priority: Normal",
      "  status: In Progress",
      "  due_date: 2025-12-31",
      "  children:",
      ...children.map((child) => `    - ${child}`),
    ].join("\n");

    assert.throws(
      () => parseIssueMetadataYaml(parsed),
      /children exceeds limit/,
    );
  });

  test("rejects invalid start_date format", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  start_date: 2025/01/01",
          ].join("\n"),
        ),
      /start_date must be YYYY-MM-DD/,
    );
  });

  test("rejects invalid done_ratio", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  done_ratio: 101",
          ].join("\n"),
        ),
      /done_ratio must be a number between 0 and 100/,
    );
  });

  test("rejects non-numeric done_ratio", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  done_ratio: fifty",
          ].join("\n"),
        ),
      /done_ratio must be a number/,
    );
  });

  test("rejects invalid estimated_hours", () => {
    assert.throws(
      () =>
        parseIssueMetadataYaml(
          [
            "issue:",
            "  tracker: Task",
            "  priority: Normal",
            "  status: In Progress",
            "  due_date: 2025-12-31",
            "  estimated_hours: lots",
          ].join("\n"),
        ),
      /estimated_hours must be a number/,
    );
  });

  test("allows valid new fields", () => {
    const parsed = parseIssueMetadataYaml(
      [
        "issue:",
        "  tracker: Task",
        "  priority: Normal",
        "  status: New",
        "  due_date: 2025-12-31",
        "  start_date: 2025-01-01",
        "  done_ratio: 50",
        "  estimated_hours: 8.5",
      ].join("\n"),
    );

    assert.strictEqual(parsed.start_date, "2025-01-01");
    assert.strictEqual(parsed.done_ratio, 50);
    assert.strictEqual(parsed.estimated_hours, 8.5);
    // assert.strictEqual(parsed.author, "John Doe"); // Removed
  });
});
