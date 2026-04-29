import * as assert from "assert";
import { buildTicketsViewItems, TicketTreeItem } from "../views/ticketsView";
import { TreeNode } from "../views/treeTypes";
import { Ticket } from "../redmine/types";

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

  test("root ticket label has no indent prefix", () => {
    const items = buildTicketsViewItems(
      [{ id: 10, subject: "Parent", projectId: 1 }],
      1,
    );
    const item = items[0] as TicketTreeItem;
    assert.strictEqual(item.label, "#10 Parent");
  });

  test("child ticket label has indent prefix", () => {
    const childNode: TreeNode<Ticket> = {
      id: 11,
      parentId: 10,
      label: "#11 Child",
      data: { id: 11, subject: "Child", projectId: 1, parentId: 10 },
      level: 1,
      children: [],
    };
    const item = new TicketTreeItem(childNode, undefined, false, false);
    assert.strictEqual(item.label, "↳ #11 Child");
  });
});
