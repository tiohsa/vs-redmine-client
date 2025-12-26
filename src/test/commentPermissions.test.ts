import * as assert from "assert";
import { filterEditableComments } from "../redmine/comments";

suite("Comment permissions", () => {
  test("filters to editable comments", () => {
    const comments = [
      { id: 1, editableByCurrentUser: true },
      { id: 2, editableByCurrentUser: false },
    ];

    const result = filterEditableComments(comments);

    assert.deepStrictEqual(result.map((comment) => comment.id), [1]);
  });
});
