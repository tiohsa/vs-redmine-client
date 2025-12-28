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
});
