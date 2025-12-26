import * as assert from "assert";
import { buildTicketsViewItems } from "../views/ticketsView";

suite("Tickets by project", () => {
  test("returns ticket items when project is selected", () => {
    const items = buildTicketsViewItems(
      [
        { id: 1, subject: "Issue", projectId: 10 },
      ],
      10,
    );

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].contextValue, "redmineTicket");
  });
});
