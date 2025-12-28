import * as assert from "assert";
import { getCommands, getMenuItems, CommandItem, MenuItem } from "./helpers/packageJson";

const findCommand = (commandId: string): CommandItem | undefined =>
  getCommands().find((command) => command.command === commandId);

const findContextItem = (commandId: string, when: string): MenuItem | undefined =>
  getMenuItems("view/item/context").find(
    (item) => item.command === commandId && item.when === when,
  );

suite("Open in browser actions", () => {
  test("declares commands with icons", () => {
    const project = findCommand("todoex.openProjectInBrowser");
    const ticket = findCommand("todoex.openTicketInBrowser");
    const comment = findCommand("todoex.openCommentInBrowser");

    assert.ok(project, "project open command must exist");
    assert.ok(ticket, "ticket open command must exist");
    assert.ok(comment, "comment open command must exist");
    assert.strictEqual(project?.icon, "$(link-external)");
    assert.strictEqual(ticket?.icon, "$(link-external)");
    assert.strictEqual(comment?.icon, "$(link-external)");
  });

  test("declares Activity Bar item actions only", () => {
    const projectItem = findContextItem(
      "todoex.openProjectInBrowser",
      "view == todoexActivityProjects && (viewItem == redmineProject || viewItem == redmineProjectSelected)",
    );
    const ticketItem = findContextItem(
      "todoex.openTicketInBrowser",
      "view == todoexActivityTickets && viewItem == redmineTicket",
    );
    const commentItem = findContextItem(
      "todoex.openCommentInBrowser",
      "view == todoexActivityComments && (viewItem == redmineComment || viewItem == redmineCommentEditable)",
    );

    assert.ok(projectItem, "project activity item action must exist");
    assert.ok(ticketItem, "ticket activity item action must exist");
    assert.ok(commentItem, "comment activity item action must exist");
    assert.strictEqual(projectItem?.group, "inline@1");
    assert.strictEqual(ticketItem?.group, "inline@2");
    assert.strictEqual(commentItem?.group, "inline@1");
  });
});
