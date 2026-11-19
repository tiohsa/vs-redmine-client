import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildYamlFieldLine,
  EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
  isCodeLensTargetFilename,
  parseTicketFrontmatterForCodeLens,
  TicketCodeLensProvider,
} from "../views/ticketCodeLensProvider";

const SAMPLE_TICKET_MD = `---
mode: ticket-update
project_id: 1
issue_id: 3
last_synced_at: 2026-11-19T13:58:00.000Z
issue:
  tracker:    Bug
  priority:   High
  status:     New
  assignee:   自分
  due_date:   2026-11-17
  done_ratio: 30
---

# Error 281 when updating a recipe

Description body.
`;

suite("TicketCodeLensProvider", () => {
  test("YAML frontmatter から issue 行と5フィールドを抽出する", () => {
    const parsed = parseTicketFrontmatterForCodeLens(SAMPLE_TICKET_MD);
    assert.ok(parsed);
    assert.strictEqual(parsed.issueLine, 5);
    assert.strictEqual(parsed.projectId, 1);
    assert.strictEqual(parsed.issueId, 3);
    assert.strictEqual(parsed.fields.tracker, "Bug");
    assert.strictEqual(parsed.fields.priority, "High");
    assert.strictEqual(parsed.fields.status, "New");
    assert.strictEqual(parsed.fields.dueDate, "2026-11-17");
    assert.strictEqual(parsed.fields.doneRatio, "30");
    assert.strictEqual(parsed.fieldLines.tracker?.line, 6);
    assert.strictEqual(parsed.fieldLines.doneRatio?.line, 11);
  });

  test("frontmatter または issue ブロックがない場合は undefined を返す", () => {
    assert.strictEqual(parseTicketFrontmatterForCodeLens("# plain markdown"), undefined);
    assert.strictEqual(parseTicketFrontmatterForCodeLens("---\ntitle: test\n---\n# body"), undefined);
  });

  test("対象ファイル名を判定する", () => {
    assert.strictEqual(isCodeLensTargetFilename("project-1_ticket-3.md"), true);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-ticket-3.md"), true);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-new-ticket.md"), true);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-new-ticket-draft-123.md"), true);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-new-comment-12.md"), false);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-comment-3-new.md"), false);
    assert.strictEqual(isCodeLensTargetFilename("redmine-client-comment-3-635.md"), false);
    assert.strictEqual(isCodeLensTargetFilename("README.md"), false);
  });

  test("YAML フィールド行のフォーマットを既存インデントを保って生成する", () => {
    assert.strictEqual(buildYamlFieldLine("tracker", "Feature", "  tracker:    "), "  tracker:    Feature");
    assert.strictEqual(buildYamlFieldLine("dueDate", "", "  due_date:   "), "  due_date:");
    assert.strictEqual(buildYamlFieldLine("doneRatio", "60"), "  done_ratio: 60");
  });

  test("issue 行に対して5つの CodeLens を並列生成する", () => {
    const provider = new TicketCodeLensProvider();
    const fakeDocument = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-ticket-3.md"),
      getText: () => SAMPLE_TICKET_MD,
    } as unknown as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(fakeDocument);
    assert.strictEqual(lenses.length, 5);
    lenses.forEach((lens) => {
      assert.strictEqual(lens.range.start.line, 5);
      assert.strictEqual(lens.command?.command, EDIT_FIELD_VIA_QUICK_PICK_COMMAND);
    });
    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.arguments?.[1]),
      ["tracker", "status", "priority", "doneRatio", "dueDate"],
    );
    provider.dispose();
  });

  test("mode: ticket-create と redmine-client-new-ticket-draft-*.md でも CodeLens を生成し、コメント下書きは除外する", () => {
    const provider = new TicketCodeLensProvider();
    const draftMd = SAMPLE_TICKET_MD.replace("mode: ticket-update", "mode: ticket-create").replace("issue_id: 3\n", "");
    const draftDoc = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-new-ticket-draft-123.md"),
      getText: () => draftMd,
    } as unknown as vscode.TextDocument;
    assert.strictEqual(provider.provideCodeLenses(draftDoc).length, 5);

    const commentDoc = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-new-comment-12.md"),
      getText: () => draftMd,
    } as unknown as vscode.TextDocument;
    assert.strictEqual(provider.provideCodeLenses(commentDoc).length, 0);

    const commentCreateDoc = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-comment-3-new.md"),
      getText: () => draftMd,
    } as unknown as vscode.TextDocument;
    assert.strictEqual(provider.provideCodeLenses(commentCreateDoc).length, 0);
    provider.dispose();
  });
});
