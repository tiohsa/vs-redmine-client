import * as assert from "assert";
import { buildCommentDashboardItems } from "../dashboard/viewModels/commentsDashboardViewModel";
import {
  addOfflineCommentUpdateAsync,
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { Comment } from "../redmine/types";
import { createTestMemento } from "./helpers/vscodeMemento";

const makeComment = (id: number): Comment => ({
  id,
  ticketId: 10,
  authorId: 1,
  authorName: "Test",
  body: "body",
  editableByCurrentUser: true,
});

suite("commentsDashboardViewModel – hasUnsyncedEdit", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento());
    await clearOfflineSyncQueueAsync();
  });
  teardown(async () => {
    await clearOfflineSyncQueueAsync();
  });

  test("未同期エントリがなければ hasUnsyncedEdit = false", async () => {
    const items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.ok(items.every((i) => !i.hasUnsyncedEdit));
  });

  test("sourceNotesHash 付きエントリがあるコメントは hasUnsyncedEdit = true", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      commentId: 2,
      body: "edited",
      documentUri: "file:///tmp/x.md",
      sourceNotesHash: "sha256:abc",
    });
    const items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
    assert.strictEqual(items[1]!.hasUnsyncedEdit, true);
    assert.deepStrictEqual(items[1]!.syncKey, { kind: "comment", ticketId: 10, commentId: 2 });
  });

  test("別チケットの同じ commentId は hasUnsyncedEdit = false", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 99,
      commentId: 2,
      body: "edited",
      documentUri: "file:///tmp/x.md",
      sourceNotesHash: "sha256:abc",
    });
    const items = buildCommentDashboardItems([makeComment(2)]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
  });

  test("編集不可コメントはキューがあっても hasUnsyncedEdit = false", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      commentId: 2,
      body: "edited",
      documentUri: "file:///tmp/x.md",
      sourceNotesHash: "sha256:abc",
    });
    const items = buildCommentDashboardItems([
      { ...makeComment(2), editableByCurrentUser: false },
    ]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
  });

  test("sourceNotesHash なしエントリは hasUnsyncedEdit = false (comment-create 区別)", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      commentId: 3,
      body: "new comment",
      documentUri: "file:///tmp/y.md",
      // sourceNotesHash なし → 新規コメント扱い
    });
    const items = buildCommentDashboardItems([makeComment(3)]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
  });

  test("新規コメント用キューはローカル未同期コメントとして先頭に表示する", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      body: "new comment",
      documentUri: "file:///tmp/new-comment.md",
    });
    const items = buildCommentDashboardItems([makeComment(3)], 10);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0]!.isLocalUnsynced, true);
    assert.strictEqual(items[0]!.body, "new comment");
    assert.strictEqual(items[0]!.hasUnsyncedEdit, true);
    assert.deepStrictEqual(items[0]!.syncKey, {
      kind: "comment",
      ticketId: 10,
      documentUri: "file:///tmp/new-comment.md",
    });
    assert.strictEqual(items[0]!.id, undefined);
    assert.strictEqual(items[1]!.hasUnsyncedEdit, false);
  });

  test("別チケットの新規コメント用キューは表示しない", async () => {
    await addOfflineCommentUpdateAsync({
      ticketId: 99,
      body: "new comment",
      documentUri: "file:///tmp/new-comment.md",
    });
    const items = buildCommentDashboardItems([makeComment(3)], 10);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]!.id, 3);
  });
});
