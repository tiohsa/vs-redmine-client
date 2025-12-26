import * as assert from "assert";
import { buildCommentUpdatePayload } from "../redmine/comments";

suite("Comment edit", () => {
  test("builds update payload", () => {
    const payload = buildCommentUpdatePayload("Updated");

    assert.deepStrictEqual(payload, {
      journal: {
        notes: "Updated",
      },
    });
  });
});
