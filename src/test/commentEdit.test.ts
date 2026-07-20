import * as assert from "assert";
import { buildCommentUpdatePayload } from "../redmine/comments";
import {
  clearCommentEdits,
  getCommentEdit,
  initializeCommentEdit,
  resolveCommentEditorBody,
  setCommentDraftBody,
} from "../views/commentEditStore";

suite("Comment edit", () => {
  teardown(() => clearCommentEdits());
  test("builds update payload", () => {
    const payload = buildCommentUpdatePayload("Updated");

    assert.deepStrictEqual(payload, {
      journal: {
        notes: "Updated",
      },
    });
  });

  test("prefers draft body when present", () => {
    initializeCommentEdit(1, 10, "Saved");
    setCommentDraftBody(1, "Draft");

    const resolved = resolveCommentEditorBody(1, "Saved");

    assert.strictEqual(resolved.source, "draft");
    assert.strictEqual(resolved.body, "Draft");
  });

  test("uses saved body when no draft exists", () => {
    initializeCommentEdit(2, 10, "Saved");

    const resolved = resolveCommentEditorBody(2, "Saved");

    assert.strictEqual(resolved.source, "saved");
    assert.strictEqual(resolved.body, "Saved");
  });

  test("同一comment IDの編集状態を接続先ごとに分離する", () => {
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeCommentEdit(7, 10, "Saved A", undefined, scopeA);
    initializeCommentEdit(7, 20, "Saved B", undefined, scopeB);
    setCommentDraftBody(7, "Draft A", scopeA);
    setCommentDraftBody(7, "Draft B", scopeB);

    assert.strictEqual(getCommentEdit(7, scopeA)?.draftBody, "Draft A");
    assert.strictEqual(getCommentEdit(7, scopeB)?.draftBody, "Draft B");
    assert.strictEqual(resolveCommentEditorBody(7, "remote", scopeA).body, "Draft A");
    assert.strictEqual(resolveCommentEditorBody(7, "remote", scopeB).body, "Draft B");
  });
});
