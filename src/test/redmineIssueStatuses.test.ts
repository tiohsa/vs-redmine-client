import * as assert from "assert";
import { listIssueStatuses } from "../redmine/issues";

suite("Redmine issue status metadata", () => {
  test("preserves is_closed as typed isClosed metadata", async () => {
    let requestedPath: string | undefined;
    const statuses = await listIssueStatuses(async (options) => {
      requestedPath = options.path;
      return {
        issue_statuses: [
          { id: 1, name: "Open", is_closed: false },
          { id: 5, name: "Closed", is_closed: true },
        ],
      };
    });

    assert.strictEqual(requestedPath, "/issue_statuses.json");
    assert.deepStrictEqual(statuses, [
      { id: 1, name: "Open", isClosed: false },
      { id: 5, name: "Closed", isClosed: true },
    ]);
  });
});
