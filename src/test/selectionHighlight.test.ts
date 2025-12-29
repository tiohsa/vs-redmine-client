import * as assert from "assert";
import * as vscode from "vscode";
import { buildCommentsViewItems } from "../views/commentsView";
import { buildProjectsViewItems, ProjectTreeItem } from "../views/projectsView";
import { buildTicketsViewItems, TicketTreeItem } from "../views/ticketsView";
import {
  SELECTION_HIGHLIGHT_COLOR_ID,
  SELECTION_HIGHLIGHT_ICON_ID,
} from "../views/selectionHighlight";
import { buildProjectFixture, buildTicketFixture } from "./helpers/treeFixtures";
import { Comment } from "../redmine/types";

const assertHighlightIcon = (item: vscode.TreeItem | undefined): void => {
  assert.ok(item, "expected item to be defined");
  assert.ok(item?.iconPath instanceof vscode.ThemeIcon);
  const icon = item?.iconPath as vscode.ThemeIcon;
  assert.strictEqual(icon.id, SELECTION_HIGHLIGHT_ICON_ID);
  assert.strictEqual(icon.color?.id, SELECTION_HIGHLIGHT_COLOR_ID);
};

suite("Selection highlight", () => {
  test("uses blue highlight for selected project", () => {
    const project = buildProjectFixture({ id: 10 });
    const items = buildProjectsViewItems([project], project.id);
    const selected = items.find((item) => item instanceof ProjectTreeItem) as
      | ProjectTreeItem
      | undefined;

    assertHighlightIcon(selected);
  });

  test("uses blue highlight for selected ticket", () => {
    const ticket = buildTicketFixture({ id: 42, projectId: 10 });
    const items = buildTicketsViewItems([ticket], ticket.projectId, undefined, undefined, new Date(), ticket.id);
    const selected = items.find((item) => item instanceof TicketTreeItem) as
      | TicketTreeItem
      | undefined;

    assertHighlightIcon(selected);
  });

  test("uses blue highlight for selected comment", () => {
    const comment: Comment = {
      id: 7,
      ticketId: 42,
      authorId: 1,
      authorName: "Alice",
      body: "Hello",
      editableByCurrentUser: true,
    };
    const [item] = buildCommentsViewItems([comment], comment.ticketId, undefined, comment.id);

    assertHighlightIcon(item);
  });

  test("does not apply highlight to unselected items", () => {
    const project = buildProjectFixture({ id: 11 });
    const items = buildProjectsViewItems([project], undefined);
    const selected = items.find((item) => item instanceof ProjectTreeItem) as
      | ProjectTreeItem
      | undefined;

    assert.ok(selected);
    assert.ok(!selected?.iconPath);
  });
});
