import * as assert from "assert";
import * as vscode from "vscode";
import {
  UnsyncedFilesTreeProvider,
  UnsyncedFileTreeItem,
} from "../views/unsyncedFilesView";
import {
  clearOfflineSyncQueue,
  addOfflineTicketUpdate,
  addOfflineCommentUpdate,
  addOfflineNewTicket,
  replaceOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const getItems = async (provider: UnsyncedFilesTreeProvider): Promise<vscode.TreeItem[]> => {
  const result = await provider.getChildren();
  return (result ?? []) as vscode.TreeItem[];
};

suite("UnsyncedFilesTreeProvider", () => {
  let provider: UnsyncedFilesTreeProvider;

  setup(() => {
    clearOfflineSyncQueue();
    provider = new UnsyncedFilesTreeProvider();
  });

  teardown(() => {
    provider.dispose();
    clearOfflineSyncQueue();
  });

  test("空のキューでは 'No unsynced local files.' を返す", async () => {
    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, "No local changes.");
  });

  test("チケット更新エントリが '#123 Ticket update' として表示される", async () => {
    const metadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(123, {
      ticketId: 123,
      baseSubject: "Base",
      baseDescription: "",
      baseMetadata: metadata,
      subject: "Updated",
      description: "",
      metadata,
    });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.ok(
      (items[0].label as string).includes("Ticket update"),
      `label must include 'Ticket update', got: ${String(items[0].label)}`,
    );
    assert.ok(
      (items[0].label as string).includes("123"),
      `label must include ticket ID 123, got: ${String(items[0].label)}`,
    );
    assert.strictEqual(items[0].description, "Local change");
  });

  test("commentId あり: '#123 Comment #456 update' として表示される", async () => {
    addOfflineCommentUpdate({
      ticketId: 123,
      commentId: 456,
      body: "Updated comment",
      documentUri: "file:///tmp/comment.md",
    });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.ok(
      (items[0].label as string).includes("Comment #456 update"),
      `label must include 'Comment #456 update', got: ${String(items[0].label)}`,
    );
    assert.strictEqual(items[0].description, "Local change");
  });

  test("commentId なし: '#123 New comment' として表示される", async () => {
    addOfflineCommentUpdate({
      ticketId: 123,
      body: "New comment body",
      documentUri: "file:///tmp/new-comment.md",
    });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.ok(
      (items[0].label as string).includes("New comment"),
      `label must include 'New comment', got: ${String(items[0].label)}`,
    );
    assert.strictEqual(items[0].description, "Local change");
  });

  test("新規チケットエントリが 'New ticket' として表示される", async () => {
    addOfflineNewTicket({ content: "# New ticket\n\nBody" });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, "New ticket");
    assert.strictEqual(items[0].description, "Local change");
  });

  test("documentUri があるエントリに vscode.open コマンドが付与される", async () => {
    addOfflineCommentUpdate({
      ticketId: 10,
      body: "body",
      documentUri: "file:///tmp/comment-10.md",
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.ok(item.command, "command must be set");
    assert.strictEqual(item.command?.command, "vscode.open");
    assert.ok(
      Array.isArray(item.command?.arguments) && item.command.arguments.length > 0,
      "arguments must be set",
    );
  });

  test("documentUri がないエントリにはコマンドが付与されない", async () => {
    const metadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(99, {
      ticketId: 99,
      baseSubject: "Base",
      baseDescription: "",
      baseMetadata: metadata,
      subject: "Updated",
      description: "",
      metadata,
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.ok(!item.command, "command must not be set when documentUri is absent");
  });

  test("オフラインSync成功後にキューをクリアするとプロバイダーが空状態を返す", async () => {
    addOfflineNewTicket({ content: "# ticket", documentUri: "file:///tmp/t.md" });

    const before = await getItems(provider);
    assert.strictEqual(before.length, 1);

    clearOfflineSyncQueue();

    const after = await getItems(provider);
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].label, "No local changes.");
  });

  test("オフライン同期キュー変更時に自動 refresh イベントを発火する", () => {
    let refreshCount = 0;
    const disposable = provider.onDidChangeTreeData(() => {
      refreshCount += 1;
    });

    addOfflineNewTicket({
      content: "# New ticket\n\nBody",
      documentUri: "file:///tmp/redmine-client-new-ticket.md",
    });

    assert.strictEqual(refreshCount, 1);
    disposable.dispose();
  });

  test("新規コメントのキュー追加時に自動 refresh イベントを発火する", () => {
    let refreshCount = 0;
    const disposable = provider.onDidChangeTreeData(() => {
      refreshCount += 1;
    });

    addOfflineCommentUpdate({
      ticketId: 123,
      body: "New comment",
      documentUri: "file:///tmp/redmine-client-new-comment-123.md",
    });

    assert.strictEqual(refreshCount, 1);
    disposable.dispose();
  });

  test("チケット更新エントリの syncKey が正しく設定される", async () => {
    const metadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(77, {
      ticketId: 77,
      baseSubject: "Base",
      baseDescription: "",
      baseMetadata: metadata,
      subject: "Updated",
      description: "",
      metadata,
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.deepStrictEqual(item.syncKey, { kind: "ticket", ticketId: 77 });
  });

  test("新規チケットエントリの syncKey が正しく設定される", async () => {
    addOfflineNewTicket({
      content: "# ticket",
      documentUri: "file:///tmp/new.md",
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.deepStrictEqual(item.syncKey, { kind: "newTicket", documentUri: "file:///tmp/new.md" });
  });

  test("コメント更新エントリの syncKey が正しく設定される", async () => {
    addOfflineCommentUpdate({
      ticketId: 55,
      commentId: 99,
      body: "body",
      documentUri: "file:///tmp/c.md",
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.deepStrictEqual(item.syncKey, {
      kind: "comment",
      ticketId: 55,
      commentId: 99,
      documentUri: "file:///tmp/c.md",
    });
  });

  test("新規コメントエントリの syncKey が正しく設定される", async () => {
    addOfflineCommentUpdate({
      ticketId: 44,
      body: "new comment",
      documentUri: "file:///tmp/nc.md",
    });

    const items = await getItems(provider);
    const item = items[0] as UnsyncedFileTreeItem;
    assert.deepStrictEqual(item.syncKey, {
      kind: "comment",
      ticketId: 44,
      documentUri: "file:///tmp/nc.md",
    });
  });

  test("オフラインSync失敗後にキューを置換すると失敗エントリが残る", async () => {
    addOfflineCommentUpdate({
      ticketId: 1,
      commentId: 10,
      body: "body",
      documentUri: "file:///tmp/c1.md",
    });
    addOfflineCommentUpdate({
      ticketId: 2,
      commentId: 20,
      body: "body",
      documentUri: "file:///tmp/c2.md",
    });

    replaceOfflineSyncQueue({
      tickets: new Map(),
      comments: [
        {
          ticketId: 2,
          commentId: 20,
          body: "body",
          documentUri: "file:///tmp/c2.md",
        },
      ],
      newTickets: [],
    });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.ok(
      (items[0].label as string).includes("Comment #20 update"),
      `残ったエントリのラベルが期待と異なる: ${String(items[0].label)}`,
    );
  });
});
