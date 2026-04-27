import * as assert from "assert";
import {
  VIEW_ID_EXPLORER_COMMENTS,
  VIEW_ID_EXPLORER_PROJECTS,
  VIEW_ID_EXPLORER_TICKETS,
} from "../views/viewIds";

suite("Activity Bar parity", () => {
  test("Explorer view IDs are defined", () => {
    assert.strictEqual(typeof VIEW_ID_EXPLORER_PROJECTS, "string");
    assert.strictEqual(typeof VIEW_ID_EXPLORER_TICKETS, "string");
    assert.strictEqual(typeof VIEW_ID_EXPLORER_COMMENTS, "string");
  });
});
