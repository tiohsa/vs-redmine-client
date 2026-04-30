import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardWorkPanel } from "../dashboard/dashboardProtocol";
import { clearOfflineSyncQueue, addOfflineNewTicket, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { clearTicketDrafts, updateDraftAfterSave } from "../views/ticketDraftStore";
import { clearRegistry, registerNewTicketDraft, setEditorProjectId, getTicketIdForEditor } from "../views/ticketEditorRegistry";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { syncNewTicketDraft, syncTicketDraft } from "../views/ticketSaveSync";
import type { TicketSaveResult } from "../views/ticketSaveTypes";

// ── ヘルパー ──────────────────────────────────────────────────────────────

const DRAFT_URI = "untitled:redmine-client-new-ticket.md";

const makeNewTicketContent = (subject: string): string =>
  buildTicketEditorContent({
    subject,
    description: "本文",
    metadata: buildIssueMetadataFixture(),
    controlFields: { mode: "new-ticket", project_id: 1, issue_id: null },
  });

const makeTicketUpdateContent = (subject: string, issueId: number): string =>
  buildTicketEditorContent({
    subject,
    description: "本文",
    metadata: buildIssueMetadataFixture(),
    controlFields: { mode: "ticket-update", project_id: 1, issue_id: issueId },
  });

const makeEditorStub = (text: string): vscode.TextEditor =>
  ({
    document: {
      uri: vscode.Uri.parse(DRAFT_URI),
      getText: () => text,
    } as vscode.TextDocument,
  }) as vscode.TextEditor;

const makeComposerWorkPanel = (draftUri?: string): DashboardWorkPanel => ({
  mode: "newTicket",
  loading: false,
  projectId: 1,
  projectName: "テストプロジェクト",
  trackers: [{ id: 1, name: "バグ" }],
  priorities: [{ id: 2, name: "通常" }],
  statuses: [{ id: 3, name: "新規" }],
  values: { subject: "", tracker: "バグ", priority: "通常", status: "新規", start_date: "", due_date: "", description: "" },
  draftUri,
});

// buildIssueMetadataFixture() の値 (Task/Normal/In Progress) に合わせたスタブ
const defaultSyncDeps = {
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
  listTrackers: async () => [{ id: 2, name: "Task" }],
  listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
};

// ── suite 1: draftUri ルーティング ─────────────────────────────────────────

suite("composerSync – draftUri ルーティング", () => {
  setup(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });
  teardown(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });

  test("コンポーザー同期は workPanel に保存された draftUri を使用する", async () => {
    const store = new DashboardStateStore();
    store.update({ workPanel: makeComposerWorkPanel(DRAFT_URI) });

    let syncedEditorUri: string | undefined;
    const editorStub = makeEditorStub(makeNewTicketContent("テストチケット"));
    const successMessages: string[] = [];

    const ctrl = new DashboardController({
      store,
      notifyOperationStarted: () => {},
      notifySuccess: (_req, msg) => successMessages.push(msg),
      notifyError: () => {},
      notifyToast: () => {},
      onTicketsRefreshed: () => {},
      _composerSyncTestHooks: {
        findEditorFn: (uri) => {
          syncedEditorUri = uri;
          return editorStub;
        },
        syncFn: async (_editor): Promise<TicketSaveResult> => ({ status: "created", message: "Ticket created." }),
        getTicketIdFn: (_editor) => 42,
        afterCreatedFn: async () => {},
      },
    });

    await ctrl.handle({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r1" });

    assert.strictEqual(syncedEditorUri, DRAFT_URI, "draftUri がそのまま同期に使われるべき");
    assert.ok(successMessages.some((m) => m.includes("作成")), "成功通知が届くべき");
  });

  test("コンポーザー同期は draftUri がない場合にキューを参照せずエラーを返す", async () => {
    const store = new DashboardStateStore();
    // draftUri なしの workPanel を設定
    store.update({ workPanel: makeComposerWorkPanel(undefined) });

    // キューに別のエントリを追加
    addOfflineNewTicket({ content: makeNewTicketContent("キューのチケット"), projectId: 1, documentUri: "untitled:other.md" });

    let syncCalled = false;
    const errors: string[] = [];

    const ctrl = new DashboardController({
      store,
      notifyOperationStarted: () => {},
      notifySuccess: () => {},
      notifyError: (_req, msg) => errors.push(msg),
      notifyToast: () => {},
      onTicketsRefreshed: () => {},
      _composerSyncTestHooks: {
        syncFn: async (_editor): Promise<TicketSaveResult> => {
          syncCalled = true;
          return { status: "created", message: "" };
        },
      },
    });

    await ctrl.handle({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r2" });

    assert.strictEqual(syncCalled, false, "draftUri がないとき sync は呼ばれるべきでない");
    assert.ok(errors.length > 0, "エラー通知が届くべき");
    assert.ok(
      errors.some((e) => e.includes("下書き") || e.includes("ドラフト") || e.includes("作成")),
      `エラーメッセージが下書き作成を促すべき (実際: ${errors.join(", ")})`,
    );

    // キューの先頭エントリが使われていないことを確認
    const queue = getOfflineSyncQueue();
    assert.strictEqual(queue.newTickets.length, 1, "キューは変更されないべき");
    assert.strictEqual(queue.newTickets[0].documentUri, "untitled:other.md", "キューのエントリが変更されないべき");
  });

  test("作成成功後、同じ draftUri のキューエントリが削除され、他エントリは残る", async () => {
    const store = new DashboardStateStore();
    store.update({ workPanel: makeComposerWorkPanel(DRAFT_URI) });

    // DRAFT_URI のエントリと、別URIのエントリをキューに追加
    addOfflineNewTicket({ content: makeNewTicketContent("作成予定チケット"), projectId: 1, documentUri: DRAFT_URI });
    addOfflineNewTicket({ content: makeNewTicketContent("別のチケット"), projectId: 1, documentUri: "untitled:other.md" });

    const editorStub = makeEditorStub(makeNewTicketContent("作成予定チケット"));

    const ctrl = new DashboardController({
      store,
      notifyOperationStarted: () => {},
      notifySuccess: () => {},
      notifyError: () => {},
      notifyToast: () => {},
      onTicketsRefreshed: () => {},
      _composerSyncTestHooks: {
        findEditorFn: (_uri) => editorStub,
        syncFn: async (_editor): Promise<TicketSaveResult> => ({ status: "created", message: "Ticket created." }),
        getTicketIdFn: (_editor) => 77,
        afterCreatedFn: async () => {},
      },
    });

    await ctrl.handle({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r-queue" });

    const queue = getOfflineSyncQueue();
    assert.ok(
      !queue.newTickets.some((item) => item.documentUri === DRAFT_URI),
      "作成済み draftUri のキューエントリが削除されるべき",
    );
    assert.ok(
      queue.newTickets.some((item) => item.documentUri === "untitled:other.md"),
      "別URIのキューエントリは残るべき",
    );
  });
});

// ── suite 2: 空件名エラー ──────────────────────────────────────────────────

suite("composerSync – 空の件名エラー", () => {
  setup(() => {
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });
  teardown(() => {
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });

  test("件名が空の場合に Markdown 見出しを促す明確なエラーメッセージが表示される", async () => {
    const store = new DashboardStateStore();
    store.update({ workPanel: makeComposerWorkPanel(DRAFT_URI) });

    const errors: string[] = [];
    const editorStub = makeEditorStub(makeNewTicketContent(""));

    const ctrl = new DashboardController({
      store,
      notifyOperationStarted: () => {},
      notifySuccess: () => {},
      notifyError: (_req, msg) => errors.push(msg),
      notifyToast: () => {},
      onTicketsRefreshed: () => {},
      _composerSyncTestHooks: {
        findEditorFn: (_uri) => editorStub,
        syncFn: async (_editor): Promise<TicketSaveResult> => ({
          status: "failed",
          message: "Ticket subject is required.",
        }),
        afterCreatedFn: async () => {},
      },
    });

    await ctrl.handle({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r3" });

    assert.ok(errors.length > 0, "エラー通知が届くべき");
    const errorMsg = errors[0];
    assert.ok(
      errorMsg.includes("件名") && errorMsg.includes("# "),
      `エラーメッセージに「件名」と「# 」が含まれるべき (実際: "${errorMsg}")`,
    );
  });
});

// ── suite 3: 作成後フロントマター書き換え ─────────────────────────────────

suite("composerSync – 作成成功後のフロントマター書き換え", () => {
  setup(() => {
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });
  teardown(() => {
    clearTicketDrafts();
    clearRegistry();
    clearNewTicketDrafts();
  });

  test("新規チケット作成成功後、エディタが ticket-update モードに書き換えられる", async () => {
    const text = makeNewTicketContent("作成テスト");
    const editorStub = makeEditorStub(text);
    registerNewTicketDraft(editorStub);
    setEditorProjectId(editorStub, 1);

    const captured: { content?: string } = {};
    const result = await syncNewTicketDraft({
      editor: editorStub,
      deps: {
        ...defaultSyncDeps,
        createIssue: async () => 100,
      },
      applyContent: async (_editor, content) => {
        captured.content = content;
      },
    });

    assert.strictEqual(result.status, "created");
    assert.ok(captured.content, "エディタ内容が書き換えられるべき");

    const parsed = parseTicketEditorContent(captured.content!);
    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.issue_id, 100);
    assert.strictEqual(parsed.controlFields?.draft_id, undefined);
  });

  test("作成成功後、同じファイルを編集して再同期できる", async () => {
    const text = makeNewTicketContent("再同期テスト");
    const editorStub = makeEditorStub(text);
    registerNewTicketDraft(editorStub);
    setEditorProjectId(editorStub, 1);

    // 1回目の同期（新規作成）
    await syncNewTicketDraft({
      editor: editorStub,
      deps: {
        ...defaultSyncDeps,
        createIssue: async () => 200,
      },
      applyContent: async () => {},
    });

    // 作成後のチケットIDをレジストリから取得
    const createdId = getTicketIdForEditor(editorStub);
    assert.ok(createdId !== undefined && createdId > 0, "チケットIDが登録されるべき");

    // ファイルを ticket-update モードで再編集した想定
    const updatedText = makeTicketUpdateContent("再同期テスト（更新済）", createdId!);
    const updateResult = await syncTicketDraft({
      ticketId: createdId!,
      content: updatedText,
      deps: {
        ...defaultSyncDeps,
        getIssueDetail: async (id) => ({
          ticket: {
            id,
            subject: "再同期テスト",
            description: "本文",
            updatedAt: "2026-01-01T00:00:00Z",
            projectId: 1,
          },
          comments: [],
        }),
        updateIssue: async () => {},
      },
    });

    // "success" か "no_change" ならOK（内容が同じ場合は no_change）
    assert.ok(
      updateResult.status === "success" || updateResult.status === "no_change",
      `再同期は成功すべき (実際: ${updateResult.status}: ${updateResult.message})`,
    );
  });

  test("2回目の同期は createIssue ではなく updateIssue を呼ぶ", async () => {
    const text = makeNewTicketContent("更新テスト");
    const editorStub = makeEditorStub(text);
    registerNewTicketDraft(editorStub);
    setEditorProjectId(editorStub, 1);

    let createCount = 0;
    let updateCount = 0;

    // 1回目の同期（新規作成）
    await syncNewTicketDraft({
      editor: editorStub,
      deps: {
        ...defaultSyncDeps,
        createIssue: async () => {
          createCount++;
          return 300;
        },
      },
      applyContent: async () => {},
    });

    const createdId = getTicketIdForEditor(editorStub);
    assert.ok(createdId !== undefined && createdId > 0);

    // updateDraftAfterSave は syncNewTicketDraft 内で呼ばれているため
    // getTicketDraft(createdId) は存在するはず

    const updatedText = makeTicketUpdateContent("更新テスト（件名変更）", createdId!);

    // 2回目の同期（更新）
    await syncTicketDraft({
      ticketId: createdId!,
      content: updatedText,
      deps: {
        ...defaultSyncDeps,
        createIssue: async () => {
          createCount++;
          return 999; // 呼ばれないはず
        },
        getIssueDetail: async (id) => ({
          ticket: {
            id,
            subject: "更新テスト",
            description: "本文",
            updatedAt: "2026-01-01T00:00:00Z",
            projectId: 1,
          },
          comments: [],
        }),
        updateIssue: async () => {
          updateCount++;
        },
      },
    });

    assert.strictEqual(createCount, 1, "createIssue は1回目のみ呼ばれるべき");
    assert.strictEqual(updateCount, 1, "2回目の同期は updateIssue を呼ぶべき");
  });
});
