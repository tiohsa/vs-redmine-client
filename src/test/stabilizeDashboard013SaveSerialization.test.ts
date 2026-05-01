import * as assert from "assert";
import * as vscode from "vscode";
import { createSyncController } from "../app/syncController";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { suppressSaveSync, releaseSaveSync } from "../views/saveSyncSuppression";
import { clearOfflineSyncQueue, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";

const makeNoopProvider = (): {
  refresh: () => void;
  notifyChange: () => void;
  refreshForTicket: (id: number) => void;
  updateTicketSubject: (id: number, s: string) => void;
} => ({
  refresh: () => undefined,
  notifyChange: () => undefined,
  refreshForTicket: () => undefined,
  updateTicketSubject: () => undefined,
});

// コメント更新ファイルのコンテンツを生成するヘルパー
// source_notes_hash に意図的に一致しないハッシュを使い、addOfflineCommentUpdate が呼ばれるようにする
const buildCommentUpdateContent = (body: string): string =>
  buildCommentUpdateFileContent(
    { issueId: 50, journalId: 888, sourceNotesHash: "sha256:fakehash_notmatching" },
    body,
  );

suite("0.1.3 安定化: 保存トリガー同期のシリアライゼーション", () => {
  teardown(() => {
    clearTicketDrafts();
    clearNewTicketDrafts();
    clearOfflineSyncQueue();
  });

  test("suppressSaveSync 有効時は syncOnSave が即座にスキップされる", (done) => {
    const callLog: string[] = [];
    const uri = vscode.Uri.parse("file:///tmp/test-suppress.md");

    const ctrl = createSyncController({
      ticketsProvider: makeNoopProvider() as unknown as import("../views/ticketsView").TicketsTreeProvider,
      commentsProvider: makeNoopProvider() as unknown as import("../views/commentsView").CommentsTreeProvider,
      unsyncedFilesProvider: makeNoopProvider() as unknown as import("../views/unsyncedFilesView").UnsyncedFilesTreeProvider,
      notifications: {
        notifyTicketSaveResult: (r: { status: string }) => callLog.push(`ticket:${r.status}`),
        notifyCommentSaveResult: (r: { status: string }) => callLog.push(`comment:${r.status}`),
      } as unknown as import("../app/notificationController").NotificationController,
      registerEditorDocument: () => undefined,
    });

    suppressSaveSync(uri.toString());

    const doc = {
      uri,
      getText: () => "",
    } as vscode.TextDocument;

    ctrl.syncOnSave(doc);

    // debounce 後に何も実行されないことを確認（300ms 待機）
    setTimeout(() => {
      releaseSaveSync(uri.toString());
      assert.deepStrictEqual(callLog, [], "suppressSaveSync 有効時は通知が発生しないこと");
      done();
    }, 350);
  });

  test("同一 URI への連続保存は debounce によりまとめられ、最後のコンテンツが処理される", (done) => {
    // コメント更新ファイル URI（performSyncOnSave の comment-update パスを経由する）
    const uri = vscode.Uri.parse("file:///tmp/redmine-client-comment-update-50-888.md");
    const refreshCount = { count: 0 };

    const ctrl = createSyncController({
      ticketsProvider: makeNoopProvider() as unknown as import("../views/ticketsView").TicketsTreeProvider,
      commentsProvider: makeNoopProvider() as unknown as import("../views/commentsView").CommentsTreeProvider,
      unsyncedFilesProvider: {
        ...makeNoopProvider(),
        refresh: () => { refreshCount.count++; },
      } as unknown as import("../views/unsyncedFilesView").UnsyncedFilesTreeProvider,
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      registerEditorDocument: () => undefined,
    });

    // 3 回の連続保存を 20ms 間隔で発火（最後のコンテンツが "Save 3"）
    const makeDoc = (body: string): vscode.TextDocument => ({
      uri,
      getText: () => buildCommentUpdateContent(body),
    } as vscode.TextDocument);

    ctrl.syncOnSave(makeDoc("Save 1"));
    setTimeout(() => ctrl.syncOnSave(makeDoc("Save 2")), 20);
    setTimeout(() => ctrl.syncOnSave(makeDoc("Save 3")), 40);

    // debounce (150ms) + 処理時間を十分に超えた後に検証
    setTimeout(() => {
      // debounce により 3 回の syncOnSave が 1 回の処理に集約されるべき
      assert.strictEqual(refreshCount.count, 1, "debounce により refresh は 1 回のみ呼ばれるべき");

      // 最後のコンテンツ "Save 3" がキューに追加されているべき
      const queue = getOfflineSyncQueue();
      const entry = queue.comments.find((c) => c.commentId === 888);
      assert.ok(entry, "コメント更新エントリがキューに存在すること");
      assert.strictEqual(entry?.body, "Save 3", "最後に保存したコンテンツがキューに反映されること");

      done();
    }, 400);
  });

  test("異なる URI の保存は独立して処理される", (done) => {
    const uri1 = vscode.Uri.parse("file:///tmp/redmine-client-comment-update-51-901.md");
    const uri2 = vscode.Uri.parse("file:///tmp/redmine-client-comment-update-52-902.md");

    const makeCommentContent = (issueId: number, journalId: number, body: string): string =>
      buildCommentUpdateFileContent(
        { issueId, journalId, sourceNotesHash: "sha256:fakehash_notmatching" },
        body,
      );

    const refreshCount = { count: 0 };

    const ctrl = createSyncController({
      ticketsProvider: makeNoopProvider() as unknown as import("../views/ticketsView").TicketsTreeProvider,
      commentsProvider: makeNoopProvider() as unknown as import("../views/commentsView").CommentsTreeProvider,
      unsyncedFilesProvider: {
        ...makeNoopProvider(),
        refresh: () => { refreshCount.count++; },
      } as unknown as import("../views/unsyncedFilesView").UnsyncedFilesTreeProvider,
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      registerEditorDocument: () => undefined,
    });

    const doc1 = { uri: uri1, getText: () => makeCommentContent(51, 901, "Doc1 body") } as vscode.TextDocument;
    const doc2 = { uri: uri2, getText: () => makeCommentContent(52, 902, "Doc2 body") } as vscode.TextDocument;

    // 2 つの異なる URI を同時に保存
    ctrl.syncOnSave(doc1);
    ctrl.syncOnSave(doc2);

    // debounce 後、両方のドキュメントが独立して処理されることを確認
    setTimeout(() => {
      assert.strictEqual(refreshCount.count, 2, "異なる URI はそれぞれ独立して処理され、refresh が 2 回呼ばれるべき");

      const queue = getOfflineSyncQueue();
      const entry1 = queue.comments.find((c) => c.commentId === 901);
      const entry2 = queue.comments.find((c) => c.commentId === 902);
      assert.ok(entry1, "URI1 のコメント更新エントリがキューに存在すること");
      assert.ok(entry2, "URI2 のコメント更新エントリがキューに存在すること");
      assert.strictEqual(entry1?.body, "Doc1 body", "URI1 のコンテンツが正しくキューに反映されること");
      assert.strictEqual(entry2?.body, "Doc2 body", "URI2 のコンテンツが正しくキューに反映されること");

      done();
    }, 400);
  });
});
