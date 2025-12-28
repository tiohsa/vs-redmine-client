import * as assert from "assert";
import {
  resolveNewTicketDraftContent,
  resolveNewTicketTemplateContent,
} from "../views/ticketPreview";
import { buildTicketEditorContent } from "../views/ticketEditorContent";

const buildTemplateContent = (): string =>
  [
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

const EMPTY_CONTENT = {
  subject: "",
  description: "",
  metadata: {
    tracker: "",
    priority: "",
    status: "",
    due_date: "",
    children: [],
  },
};

suite("New ticket template resolution", () => {
  test("rejects relative template paths", () => {
    const result = resolveNewTicketTemplateContent({
      templatePath: "relative/template.md",
      existsSync: () => true,
      readFileSync: () => buildTemplateContent(),
    });

    assert.strictEqual(result.errorMessage, "Template file path must be an absolute path.");
  });

  test("reports missing template files", () => {
    const result = resolveNewTicketTemplateContent({
      templatePath: "/missing/template.md",
      existsSync: () => false,
      readFileSync: () => buildTemplateContent(),
    });

    assert.strictEqual(result.errorMessage, "Template file does not exist.");
  });

  test("parses valid template content", () => {
    const result = resolveNewTicketTemplateContent({
      templatePath: "/valid/template.md",
      existsSync: () => true,
      readFileSync: () => buildTemplateContent(),
    });

    assert.ok(result.content);
    assert.strictEqual(result.content?.subject, "Template subject");
    assert.strictEqual(result.content?.metadata.tracker, "Task");
  });

  test("accepts templates without a subject line", () => {
    const template = [
      "---",
      "issue:",
      "  tracker: Task",
      "  priority: Normal",
      "  status: New",
      "  due_date: 2025-01-01",
      "---",
      "",
      "Template body",
    ].join("\n");

    const result = resolveNewTicketTemplateContent({
      templatePath: "/valid/template.md",
      existsSync: () => true,
      readFileSync: () => template,
    });

    assert.ok(result.content);
    assert.strictEqual(result.content?.subject, "");
    assert.strictEqual(result.content?.description, "Template body");
  });

  test("keeps a single empty subject line when template includes '# '", () => {
    const template = [
      "---",
      "issue:",
      "  tracker: Bug",
      "  priority: Normal",
      "  status: New",
      "  due_date: 2025-12-29",
      "---",
      "",
      "# ",
      "",
      "",
    ].join("\n");

    const result = resolveNewTicketTemplateContent({
      templatePath: "/valid/template.md",
      existsSync: () => true,
      readFileSync: () => template,
    });

    assert.ok(result.content);
    const rendered = buildTicketEditorContent(result.content);
    const subjectLineCount = rendered.split("\n").filter((line) => line.trim() === "#").length;
    assert.strictEqual(subjectLineCount, 1);
  });

  test("falls back to empty content when template is empty", () => {
    const result = resolveNewTicketDraftContent({
      templatePath: "/empty/template.md",
      existsSync: () => true,
      readFileSync: () => "   ",
    });

    assert.strictEqual(result.usedTemplate, false);
    assert.strictEqual(result.errorMessage, "Template file is empty.");
    assert.deepStrictEqual(result.content, EMPTY_CONTENT);
  });
});
