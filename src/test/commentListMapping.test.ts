import * as assert from "assert";
import { mapIssueJournalsToComments } from "../redmine/comments";
import { RedmineIssueDetailResponseIssue } from "../redmine/types";

suite("Comment list mapping", () => {
  test("excludes journals without notes and preserves note index order", () => {
    const issue: RedmineIssueDetailResponseIssue = {
      id: 10,
      subject: "Issue",
      project: { id: 1, name: "Project" },
      journals: [
        { id: 1, notes: "", user: { id: 1, name: "User" } },
        { id: 2, notes: "First comment", user: { id: 2, name: "Bob" } },
        { id: 3, notes: "  ", user: { id: 3, name: "Sue" } },
        { id: 4, notes: "Second comment", user: { id: 4, name: "Ann" } },
      ],
    };

    const comments = mapIssueJournalsToComments(issue, 2);
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].id, 2);
    assert.strictEqual(comments[0].noteIndex, 2);
    assert.strictEqual(comments[1].id, 4);
    assert.strictEqual(comments[1].noteIndex, 4);
  });
});
