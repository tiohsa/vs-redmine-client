import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";
import { buildDraftTicketDashboardNodes, extractNewTicketDraftSubject } from "../dashboard/viewModels/ticketDashboardViewModel";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import { runWithConnectionScope } from "../redmine/client";
import {
  buildDirectTicketFilename,
  buildNewTicketDraftFilename,
  isNewTicketDraftFilename,
  parseDirectTicketFilename,
} from "../views/editorFilename";
import {
  addOfflineNewTicketAsync,
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { findSubjectTextRange } from "../views/ticketPreview";
import { renameSyncedNewTicketFileIfEligible } from "../views/ticketSync/ticketEditorRewrite";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://new-draft-flow.example.com/";

suite("New ticket quick draft flow & filename round-trip", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    await clearOfflineSyncQueueAsync(SCOPE);
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync(SCOPE);
  });

  test("draft-ID 付き新規下書きファイル名と直接チケットファイル名を相互判定できる", () => {
    const draftName = buildNewTicketDraftFilename(undefined, "draft-1700000000000-1");
    assert.strictEqual(draftName, "redmine-client-new-ticket-draft-1700000000000-1.md");
    assert.strictEqual(isNewTicketDraftFilename(draftName), true);
    assert.strictEqual(
      isNewTicketDraftFilename(buildNewTicketDraftFilename("0123456789abcdef", "draft-42")),
      true,
    );

    const directName = buildDirectTicketFilename(987);
    assert.strictEqual(directName, "redmine-client-ticket-987.md");
    assert.strictEqual(parseDirectTicketFilename(directName), 987);
    assert.strictEqual(parseDirectTicketFilename("redmine-client-abcd1234abcd1234-ticket-55.md"), 55);
    assert.strictEqual(parseDirectTicketFilename(draftName), undefined);
  });

  test("mode: ticket-create は status 空でも往復パースでき件名範囲を特定できる", () => {
    const markdown = buildTicketEditorContent({
      subject: "新規チケット件名",
      description: "詳細本文",
      metadata: {
        tracker: "Bug",
        priority: "Normal",
        status: "",
        due_date: "2026-12-01",
        start_date: "",
      },
      controlFields: {
        mode: "ticket-create",
        project_id: 12,
      },
    });
    assert.ok(markdown.includes("mode: ticket-create"));
    const parsed = parseTicketEditorContent(markdown);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-create");
    assert.strictEqual(parsed.controlFields?.project_id, 12);
    assert.strictEqual(parsed.subject, "新規チケット件名");
    assert.strictEqual(parsed.metadata.status, "");

    const range = findSubjectTextRange(markdown);
    assert.ok(range, "件名行の選択範囲を取得できること");
    const lineText = markdown.split(/\r?\n/)[range.line];
    assert.strictEqual(lineText.slice(range.startChar, range.endChar), "新規チケット件名");
  });

  test("Dashboard メッセージ検証が preserveFocus / projectId / openDraft / syncDraft を検証する", () => {
    const validSelect = validateDashboardMessage({
      type: "ticket.select",
      requestId: "r1",
      ticketId: 10,
      preserveFocus: true,
    });
    assert.strictEqual(validSelect.ok, true);
    const badSelect = validateDashboardMessage({
      type: "ticket.select",
      requestId: "r1",
      ticketId: 10,
      preserveFocus: "yes",
    });
    assert.strictEqual(badSelect.ok, false);

    const validCreate = validateDashboardMessage({
      type: "ticket.create",
      requestId: "r2",
      projectId: 5,
    });
    assert.strictEqual(validCreate.ok, true);
    const badCreate = validateDashboardMessage({
      type: "ticket.create",
      requestId: "r2",
      projectId: -1,
    });
    assert.strictEqual(badCreate.ok, false);

    const validOpenDraft = validateDashboardMessage({
      type: "ticket.openDraft",
      requestId: "r3",
      queueId: "q1",
      documentUri: "file:///tmp/redmine-client-new-ticket-draft-1.md",
      preserveFocus: true,
    });
    assert.strictEqual(validOpenDraft.ok, true);
    const badOpenDraft = validateDashboardMessage({
      type: "ticket.openDraft",
      requestId: "r3",
      queueId: "",
      documentUri: "file:///tmp/a.md",
    });
    assert.strictEqual(badOpenDraft.ok, false);

    const validSyncDraft = validateDashboardMessage({
      type: "ticket.syncDraft",
      requestId: "r4",
      queueId: "q1",
      documentUri: "file:///tmp/redmine-client-new-ticket-draft-1.md",
    });
    assert.strictEqual(validSyncDraft.ok, true);
    const badSyncDraft = validateDashboardMessage({
      type: "ticket.syncDraft",
      requestId: "r4",
      queueId: "q1",
      documentUri: "   ",
    });
    assert.strictEqual(badSyncDraft.ok, false);
  });

  test("buildDraftTicketDashboardNodes がプロジェクト階層・件名抽出・状態を反映し Unsynced にも #NEW 件名を表示する", async () => {
    await runWithConnectionScope(SCOPE, async () => {
      await addOfflineNewTicketAsync(
        {
          content: buildTicketEditorContent({
            subject: "子プロジェクトの新規ドラフト",
            description: "本文",
            metadata: { tracker: "Task", priority: "High", status: "", due_date: "2026-12-31", start_date: "" },
            controlFields: { mode: "ticket-create", project_id: 2 },
          }),
          projectId: 2,
          documentUri: "untitled:redmine-client-new-ticket-draft-child.md",
        },
        SCOPE,
      );
      await addOfflineNewTicketAsync(
        {
          content: "# 失敗したドラフト件名\n\n詳細",
          projectId: 3,
          documentUri: "untitled:redmine-client-new-ticket-draft-failed.md",
          preparationFailure: "Tracker invalid",
        },
        SCOPE,
      );

      const projects = [
        { id: 1, name: "Parent", identifier: "parent", level: 0 },
        { id: 2, name: "Child", identifier: "child", parentId: 1, level: 1 },
        { id: 3, name: "Other", identifier: "other", level: 0 },
      ];

      assert.strictEqual(extractNewTicketDraftSubject("---\nmode: ticket-create\n---\n\n# 抽出テスト"), "抽出テスト");

      const parentOnly = buildDraftTicketDashboardNodes({
        selectedProjectId: 1,
        includeChildProjects: false,
        projects,
      });
      assert.strictEqual(parentOnly.length, 0);

      const withChildren = buildDraftTicketDashboardNodes({
        selectedProjectId: 1,
        includeChildProjects: true,
        projects,
      });
      assert.strictEqual(withChildren.length, 1);
      assert.strictEqual(withChildren[0].subject, "子プロジェクトの新規ドラフト");
      assert.strictEqual(withChildren[0].syncState, "Draft");
      assert.strictEqual(withChildren[0].priorityName, "High");

      const allDrafts = buildDraftTicketDashboardNodes();
      assert.strictEqual(allDrafts.length, 2);
      const failedDraft = allDrafts.find((d) => d.projectId === 3);
      assert.strictEqual(failedDraft?.subject, "失敗したドラフト件名");
      assert.strictEqual(failedDraft?.syncState, "Failed");

      const unsyncedItems = buildUnsyncedDashboardItems();
      assert.ok(unsyncedItems.some((item) => item.label === "#NEW 子プロジェクトの新規ドラフト"));
      assert.ok(unsyncedItems.some((item) => item.label === "#NEW 失敗したドラフト件名"));
    });
  });

  test("renameSyncedNewTicketFileIfEligible が安全な条件のみリネームし不正条件は無害に元のURIを返す", async () => {
    const nonFile = vscode.Uri.parse("untitled:redmine-client-new-ticket-draft-1.md");
    assert.strictEqual(
      (await renameSyncedNewTicketFileIfEligible({
        oldUri: nonFile,
        ticketId: 777,
        connectionScope: SCOPE,
      })).toString(),
      nonFile.toString(),
    );

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-rename-test-"));
    try {
      const missingUri = vscode.Uri.file(path.join(tempDir, "redmine-client-new-ticket-draft-missing.md"));
      assert.strictEqual(
        (await renameSyncedNewTicketFileIfEligible({
          oldUri: missingUri,
          ticketId: 777,
          connectionScope: SCOPE,
        })).fsPath,
        missingUri.fsPath,
      );

      const draftPath = path.join(tempDir, "redmine-client-new-ticket-draft-ok.md");
      const targetPath = path.join(tempDir, "redmine-client-ticket-777.md");
      fs.writeFileSync(draftPath, "# Synced\n", "utf8");
      const renamed = await renameSyncedNewTicketFileIfEligible({
        oldUri: vscode.Uri.file(draftPath),
        ticketId: 777,
        projectId: 1,
        connectionScope: SCOPE,
      });
      assert.strictEqual(renamed.fsPath, targetPath);
      assert.strictEqual(fs.existsSync(targetPath), true);
      assert.strictEqual(fs.existsSync(draftPath), false);

      const collisionDraftPath = path.join(tempDir, "redmine-client-new-ticket-draft-collide.md");
      fs.writeFileSync(collisionDraftPath, "# Collide\n", "utf8");
      const stayed = await renameSyncedNewTicketFileIfEligible({
        oldUri: vscode.Uri.file(collisionDraftPath),
        ticketId: 777,
        connectionScope: SCOPE,
      });
      assert.strictEqual(stayed.fsPath, collisionDraftPath);
      assert.strictEqual(fs.existsSync(collisionDraftPath), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
