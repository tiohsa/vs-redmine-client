import * as assert from "assert";
import { createTemplateFixture } from "./helpers/templateFixtures";
import { resolveProjectTemplateContent } from "../utils/templateResolver";

const buildTemplateContent = (subject: string): string =>
  [
    "---",
    "issue:",
    "  tracker: Task",
    "  priority: Normal",
    "  status: New",
    "  due_date: 2025-01-01",
    "---",
    "",
    `# ${subject}`,
    "",
    "Template body",
  ].join("\n");

suite("Project template resolver", () => {
  test("resolves project template when a single match exists", () => {
    const fixture = createTemplateFixture("/templates", {
      "Alpha.md": buildTemplateContent("Alpha Subject"),
      "default.md": buildTemplateContent("Default Subject"),
    });

    const result = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "alpha",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });

    assert.ok(result.content);
    assert.strictEqual(result.usedTemplate, true);
    assert.strictEqual(result.usedDefault, false);
    assert.strictEqual(result.content?.subject, "Alpha Subject");
  });

  test("falls back to default when no project template matches", () => {
    const fixture = createTemplateFixture("/templates", {
      "default.md": buildTemplateContent("Default Subject"),
    });

    const result = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "Beta",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });

    assert.ok(result.content);
    assert.strictEqual(result.usedTemplate, false);
    assert.strictEqual(result.usedDefault, true);
    assert.strictEqual(result.content?.subject, "Default Subject");
  });

  test("falls back to default when multiple templates match", () => {
    const fixture = createTemplateFixture("/templates", {
      "Alpha.md": buildTemplateContent("Alpha 1"),
      "Alpha copy.md": buildTemplateContent("Alpha 2"),
      "default.md": buildTemplateContent("Default Subject"),
    });

    const result = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "Alpha",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });

    assert.ok(result.content);
    assert.strictEqual(result.usedDefault, true);
    assert.strictEqual(result.errorMessage, "Multiple project templates matched.");
  });

  test("reports missing default template", () => {
    const fixture = createTemplateFixture("/templates", {
      "Alpha.md": buildTemplateContent("Alpha Subject"),
    });

    const result = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "Beta",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });

    assert.strictEqual(result.content, undefined);
    assert.strictEqual(result.errorMessage, "Default template file does not exist.");
  });

  test("reads updated template content each time", () => {
    const files = {
      "Alpha.md": buildTemplateContent("Alpha Subject"),
      "default.md": buildTemplateContent("Default Subject"),
    };
    const fixture = createTemplateFixture("/templates", files);

    const first = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "Alpha",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });
    assert.strictEqual(first.content?.subject, "Alpha Subject");

    files["Alpha.md"] = buildTemplateContent("Alpha Updated");
    const second = resolveProjectTemplateContent({
      templatesDir: fixture.templatesDir,
      projectName: "Alpha",
      existsSync: fixture.existsSync,
      readFileSync: fixture.readFileSync,
      readdirSync: fixture.readdirSync,
    });
    assert.strictEqual(second.content?.subject, "Alpha Updated");
  });
});
