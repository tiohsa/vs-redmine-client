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
    clearOfflineSyncQueue();
  });

  test("空のキューでは 'No unsynced local files.' を返す", async () => {
    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, "No unsynced local files.");
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
    assert.strictEqual(items[0].description, "Not synced");
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
    assert.strictEqual(items[0].description, "Not synced");
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
    assert.strictEqual(items[0].description, "Not synced");
  });

  test("新規チケットエントリが 'New ticket' として表示される", async () => {
    addOfflineNewTicket({ content: "# New ticket\n\nBody" });

    const items = await getItems(provider);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, "New ticket");
    assert.strictEqual(items[0].description, "Not synced");
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
    assert.strictEqual(after[0].label, "No unsynced local files.");
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
