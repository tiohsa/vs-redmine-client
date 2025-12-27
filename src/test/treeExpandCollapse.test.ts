import * as assert from "assert";
import * as vscode from "vscode";
import { buildProjectsViewItems, ProjectTreeItem } from "../views/projectsView";
import { buildTicketsViewItems, TicketTreeItem } from "../views/ticketsView";
import { clearTreeExpansionState, setTreeExpanded } from "../views/treeState";

suite("Tree expand/collapse", () => {
  test("projects reflect stored expansion state", () => {
    clearTreeExpansionState("projects");
    setTreeExpanded("projects", "1", true);

    const items = buildProjectsViewItems([
      { id: 1, name: "Parent", identifier: "parent" },
      { id: 2, name: "Child", identifier: "child", parentId: 1 },
    ]);

    const root = items[0] as ProjectTreeItem;
    assert.strictEqual(root.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });

  test("tickets reflect stored expansion state", () => {
    clearTreeExpansionState("tickets");
    setTreeExpanded("tickets", "10", true);

    const items = buildTicketsViewItems(
      [
        { id: 10, subject: "Parent", projectId: 1 },
        { id: 11, subject: "Child", projectId: 1, parentId: 10 },
      ],
      1,
    );

    const root = items[0] as TicketTreeItem;
    assert.strictEqual(root.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });
});
