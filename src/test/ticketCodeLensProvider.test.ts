import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildYamlFieldLine,
  EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
  editTicketFieldViaQuickPick,
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
  start_date: 2026-11-10
  due_date:   2026-11-17
  done_ratio: 30
---

# Error 281 when updating a recipe

Description body.
`;

suite("TicketCodeLensProvider", () => {
  test("YAML frontmatter から issue 行と6フィールドを抽出する", () => {
    const parsed = parseTicketFrontmatterForCodeLens(SAMPLE_TICKET_MD);
    assert.ok(parsed);
    assert.strictEqual(parsed.issueLine, 5);
    assert.strictEqual(parsed.projectId, 1);
    assert.strictEqual(parsed.issueId, 3);
    assert.strictEqual(parsed.fields.tracker, "Bug");
    assert.strictEqual(parsed.fields.priority, "High");
    assert.strictEqual(parsed.fields.status, "New");
    assert.strictEqual(parsed.fields.startDate, "2026-11-10");
    assert.strictEqual(parsed.fields.dueDate, "2026-11-17");
    assert.strictEqual(parsed.fields.doneRatio, "30");
    assert.strictEqual(parsed.fieldLines.tracker?.line, 6);
    assert.strictEqual(parsed.fieldLines.startDate?.line, 10);
    assert.strictEqual(parsed.fieldLines.doneRatio?.line, 12);
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
    assert.strictEqual(buildYamlFieldLine("startDate", "2026-11-12", "  start_date: "), "  start_date: 2026-11-12");
    assert.strictEqual(buildYamlFieldLine("startDate", "", "  start_date: "), "  start_date:");
    assert.strictEqual(buildYamlFieldLine("dueDate", "", "  due_date:   "), "  due_date:");
    assert.strictEqual(buildYamlFieldLine("doneRatio", "60"), "  done_ratio: 60");
  });

  test("issue 行に対して6つの CodeLens を並列生成する", () => {
    const provider = new TicketCodeLensProvider();
    const fakeDocument = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-ticket-3.md"),
      getText: () => SAMPLE_TICKET_MD,
    } as unknown as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(fakeDocument);
    assert.strictEqual(lenses.length, 6);
    lenses.forEach((lens) => {
      assert.strictEqual(lens.range.start.line, 5);
      assert.strictEqual(lens.command?.command, EDIT_FIELD_VIA_QUICK_PICK_COMMAND);
    });
    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.arguments?.[1]),
      ["tracker", "status", "priority", "doneRatio", "startDate", "dueDate"],
    );
    assert.ok(lenses[4].command?.title.includes("2026-11-10"));
    provider.dispose();
  });

  test("start_date が未設定の場合は未設定表示の CodeLens を生成する", () => {
    const provider = new TicketCodeLensProvider();
    const withoutStartDate = SAMPLE_TICKET_MD.replace("  start_date: 2026-11-10\n", "");
    const fakeDocument = {
      languageId: "markdown",
      uri: vscode.Uri.file("/tmp/redmine-client-ticket-3.md"),
      getText: () => withoutStartDate,
    } as unknown as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(fakeDocument);
    assert.strictEqual(lenses.length, 6);
    assert.strictEqual(lenses[4].command?.arguments?.[1], "startDate");
    assert.strictEqual(lenses[4].command?.title, vscode.l10n.t("Start date: {0}", vscode.l10n.t("Not set")));
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
    assert.strictEqual(provider.provideCodeLenses(draftDoc).length, 6);

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

  test("editTicketFieldViaQuickPick で startDate の候補選択・カスタム入力検証・クリア・キャンセルを処理する", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: SAMPLE_TICKET_MD,
    });

    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalShowInputBox = vscode.window.showInputBox;
    const originalActiveTextEditor = vscode.window.activeTextEditor;

    try {
      const windowObj = vscode.window as unknown as {
        showQuickPick: (items: unknown, options?: unknown) => Promise<unknown>;
        showInputBox: (options?: vscode.InputBoxOptions) => Promise<string | undefined>;
      };

      // 1. カスタム入力でバリデーションと更新を確認
      windowObj.showQuickPick = async (items) => {
        const list = (await items) as Array<{ label: string; value: string }>;
        return list.find((item) => item.value === "__custom__");
      };
      let capturedValidateInput: ((value: string) => string | undefined | null | Promise<string | undefined | null>) | undefined;
      windowObj.showInputBox = async (options) => {
        capturedValidateInput = options?.validateInput as typeof capturedValidateInput;
        return "2026-11-12";
      };

      await editTicketFieldViaQuickPick(doc.uri, "startDate");
      assert.ok(capturedValidateInput);
      assert.strictEqual(capturedValidateInput("2026-11-12"), undefined);
      assert.strictEqual(capturedValidateInput(""), undefined);
      assert.ok(capturedValidateInput("2026/11/12"));
      assert.ok(doc.getText().includes("  start_date: 2026-11-12"));

      // 2. クリア選択で空値になることを確認
      windowObj.showQuickPick = async (items) => {
        const list = (await items) as Array<{ label: string; value: string }>;
        return list.find((item) => item.value === "");
      };
      await editTicketFieldViaQuickPick(doc.uri, "startDate");
      assert.ok(doc.getText().includes("  start_date:\n"));

      // 3. キャンセル時は内容が変更されないことを確認
      const beforeCancel = doc.getText();
      windowObj.showQuickPick = async () => undefined;
      await editTicketFieldViaQuickPick(doc.uri, "startDate");
      assert.strictEqual(doc.getText(), beforeCancel);

      // 4. フィールド選択メニュー経由（startDate 指定なし）で startDate が選択可能であること
      Object.defineProperty(vscode.window, "activeTextEditor", {
        configurable: true,
        get: () => ({ document: doc }),
      });
      let quickPickCallCount = 0;
      windowObj.showQuickPick = async (items) => {
        quickPickCallCount += 1;
        const list = (await items) as Array<{ label: string; value: string }>;
        if (quickPickCallCount === 1) {
          return list.find((item) => item.value === "startDate");
        }
        return list[0]; // Today
      };
      await editTicketFieldViaQuickPick();
      assert.strictEqual(quickPickCallCount, 2);
      const updated = parseTicketFrontmatterForCodeLens(doc.getText());
      assert.ok(updated?.fields.startDate && /^\d{4}-\d{2}-\d{2}$/.test(updated.fields.startDate));
    } finally {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
      (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = originalShowInputBox;
      if (originalActiveTextEditor !== undefined) {
        Object.defineProperty(vscode.window, "activeTextEditor", {
          configurable: true,
          get: () => originalActiveTextEditor,
        });
      } else {
        delete (vscode.window as unknown as Record<string, unknown>).activeTextEditor;
      }
    }
  });
});
