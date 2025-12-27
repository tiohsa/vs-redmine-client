import * as assert from "assert";
import { buildTicketsViewItems, TicketTreeItem } from "../views/ticketsView";

suite("Tickets tree view", () => {
  test("builds hierarchical ticket items", () => {
    const items = buildTicketsViewItems(
      [
        { id: 10, subject: "Parent", projectId: 1 },
        { id: 11, subject: "Child", projectId: 1, parentId: 10 },
      ],
      1,
    );

    const root = items[0] as TicketTreeItem;
    assert.strictEqual(root.ticket.subject, "Parent");
    assert.strictEqual(root.childNodes.length, 1);
    assert.strictEqual(root.childNodes[0].data.subject, "Child");
  });
});
