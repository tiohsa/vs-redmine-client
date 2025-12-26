import * as assert from "assert";
import { buildTicketsViewItems } from "../views/ticketsView";

suite("Tickets empty state", () => {
  test("returns empty state when no tickets", () => {
    const items = buildTicketsViewItems([], 10);

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].contextValue, "viewStateEmpty");
  });
});
