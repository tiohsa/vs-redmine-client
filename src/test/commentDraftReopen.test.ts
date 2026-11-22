import * as assert from "assert";
import {
  shouldSeedStoredCommentDraft,
  shouldSeedUntitledCommentDraft,
} from "../commands/openCommentUpdateDraft";

suite("Comment update draft reopen", () => {
  test("初回オープン時だけサーバー内容で保存ファイルを作成する", () => {
    assert.strictEqual(shouldSeedStoredCommentDraft(false), true);
    assert.strictEqual(shouldSeedStoredCommentDraft(true), false);
  });

  test("untitledの再オープン時は入力済み内容を追記しない", () => {
    assert.strictEqual(shouldSeedUntitledCommentDraft(""), true);
    assert.strictEqual(shouldSeedUntitledCommentDraft("user draft"), false);
  });
});
