import * as assert from "assert";
import { buildCommentDashboardItems } from "../dashboard/viewModels/commentsDashboardViewModel";
import {
  addOfflineCommentUpdateAsync,
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { clearCommentEdits, setCommentEditingState } from "../views/commentEditStore";
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
    clearCommentEdits();
  });
  teardown(async () => {
    await clearOfflineSyncQueueAsync();
    clearCommentEdits();
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

  test("編集中のコメントは isEditing = true になり、キュー済み本文と一致すれば false に戻る", async () => {
    setCommentEditingState(10, 2, true, "editing body");
    let items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.strictEqual(items[0]!.isEditing, false);
    assert.strictEqual(items[1]!.isEditing, true);

    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      commentId: 2,
      body: "editing body",
      documentUri: "file:///tmp/x.md",
      sourceNotesHash: "sha256:abc",
    });
    items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.strictEqual(items[1]!.isEditing, false);
    assert.strictEqual(items[1]!.hasUnsyncedEdit, true);

    setCommentEditingState(10, 2, true, "editing body 2");
    items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.strictEqual(items[1]!.isEditing, true);
  });

  test("編集不可コメントや別スコープの編集中状態は isEditing = false", () => {
    setCommentEditingState(10, 2, true, "editing body", "https://other.example/");
    const items = buildCommentDashboardItems([
      { ...makeComment(2), editableByCurrentUser: false },
    ]);
    assert.strictEqual(items[0]!.isEditing, false);
  });
});
