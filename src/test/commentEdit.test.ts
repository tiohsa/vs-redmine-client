import * as assert from "assert";
import { buildCommentUpdatePayload } from "../redmine/comments";
import {
  initializeCommentEdit,
  resolveCommentEditorBody,
  setCommentDraftBody,
} from "../views/commentEditStore";

suite("Comment edit", () => {
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
});
