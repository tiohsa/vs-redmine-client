import * as assert from "assert";
import {
  ACTIVITY_VIEW_PAIRS,
  VIEW_ID_ACTIVITY_COMMENTS,
  VIEW_ID_ACTIVITY_PROJECTS,
  VIEW_ID_ACTIVITY_TICKETS,
  VIEW_ID_EXPLORER_COMMENTS,
  VIEW_ID_EXPLORER_PROJECTS,
  VIEW_ID_EXPLORER_TICKETS,
} from "../views/viewIds";

suite("Activity Bar parity", () => {
  test("maps explorer views to Activity Bar views", () => {
    assert.strictEqual(ACTIVITY_VIEW_PAIRS.length, 3);

    const ids = ACTIVITY_VIEW_PAIRS.map((pair) => pair.activityId);
    assert.deepStrictEqual(ids, [
      VIEW_ID_ACTIVITY_PROJECTS,
      VIEW_ID_ACTIVITY_TICKETS,
      VIEW_ID_ACTIVITY_COMMENTS,
    ]);

    const explorerIds = ACTIVITY_VIEW_PAIRS.map((pair) => pair.explorerId);
    assert.deepStrictEqual(explorerIds, [
      VIEW_ID_EXPLORER_PROJECTS,
      VIEW_ID_EXPLORER_TICKETS,
      VIEW_ID_EXPLORER_COMMENTS,
    ]);
  });
});
