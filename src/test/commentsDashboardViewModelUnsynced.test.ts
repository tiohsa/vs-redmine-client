import * as assert from "assert";
import { buildCommentDashboardItems } from "../dashboard/viewModels/commentsDashboardViewModel";
import {
  addOfflineCommentUpdate,
  clearOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { Comment } from "../redmine/types";

const makeComment = (id: number): Comment => ({
  id,
  ticketId: 10,
  authorId: 1,
  authorName: "Test",
  body: "body",
  editableByCurrentUser: true,
});

suite("commentsDashboardViewModel – hasUnsyncedEdit", () => {
  setup(() => { clearOfflineSyncQueue(); });
  teardown(() => { clearOfflineSyncQueue(); });

  test("未同期エントリがなければ hasUnsyncedEdit = false", () => {
    const items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.ok(items.every((i) => !i.hasUnsyncedEdit));
  });

  test("sourceNotesHash 付きエントリがあるコメントは hasUnsyncedEdit = true", () => {
    addOfflineCommentUpdate({
      ticketId: 10,
      commentId: 2,
      body: "edited",
      documentUri: "file:///tmp/x.md",
      sourceNotesHash: "sha256:abc",
    });
    const items = buildCommentDashboardItems([makeComment(1), makeComment(2)]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
    assert.strictEqual(items[1]!.hasUnsyncedEdit, true);
  });

  test("sourceNotesHash なしエントリは hasUnsyncedEdit = false (comment-create 区別)", () => {
    addOfflineCommentUpdate({
      ticketId: 10,
      commentId: 3,
      body: "new comment",
      documentUri: "file:///tmp/y.md",
      // sourceNotesHash なし → 新規コメント扱い
    });
    const items = buildCommentDashboardItems([makeComment(3)]);
    assert.strictEqual(items[0]!.hasUnsyncedEdit, false);
  });
});
