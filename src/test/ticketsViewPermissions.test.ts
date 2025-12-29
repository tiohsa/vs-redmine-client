import * as assert from "assert";
import { clearViewContext, getViewContext } from "../views/viewContext";
import {
  CREATE_TICKET_CONTEXT_KEY,
  evaluateCreateTicketPermission,
  refreshCreateTicketContext,
  TicketTreeItem,
} from "../views/ticketsView";
import { TreeNode } from "../views/treeTypes";

suite("Tickets view permissions", () => {
  teardown(() => {
    clearViewContext();
  });

  test("evaluates create ticket permission based on settings", () => {
    assert.strictEqual(evaluateCreateTicketPermission("https://example", "key"), true);
    assert.strictEqual(evaluateCreateTicketPermission("", "key"), false);
    assert.strictEqual(evaluateCreateTicketPermission("https://example", ""), false);
  });

  test("refreshes create ticket context", () => {
    refreshCreateTicketContext("https://example", "key");

    assert.strictEqual(getViewContext(CREATE_TICKET_CONTEXT_KEY), true);
  });

  test("combines status and due date indicators in ticket description", () => {
    const node: TreeNode<{ id: number; subject: string; projectId: number; statusName: string }> = {
      id: 1,
      parentId: undefined,
      label: "#1 Issue",
      data: { id: 1, subject: "Issue", projectId: 1, statusName: "Open" },
      level: 0,
      children: [],
    };
    const item = new TicketTreeItem(node, "Due in 3 days", false, false);

    assert.strictEqual(item.description, "Open · Due in 3 days");
  });
});
