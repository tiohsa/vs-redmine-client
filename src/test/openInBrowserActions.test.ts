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
    const project = findCommand("redmine-client.openProjectInBrowser");
    const ticket = findCommand("redmine-client.openTicketInBrowser");
    const comment = findCommand("redmine-client.openCommentInBrowser");

    assert.ok(project, "project open command must exist");
    assert.ok(ticket, "ticket open command must exist");
    assert.ok(comment, "comment open command must exist");
    assert.strictEqual(project?.icon, "$(link-external)");
    assert.strictEqual(ticket?.icon, "$(link-external)");
    assert.strictEqual(comment?.icon, "$(link-external)");
  });

  test("declares Activity Bar item actions only", () => {
    const projectItem = findContextItem(
      "redmine-client.openProjectInBrowser",
      "view == redmine-clientActivityProjects && (viewItem == redmineProject || viewItem == redmineProjectSelected)",
    );
    const ticketItem = findContextItem(
      "redmine-client.openTicketInBrowser",
      "view == redmine-clientActivityTickets && viewItem == redmineTicket",
    );
    const commentItem = findContextItem(
      "redmine-client.openCommentInBrowser",
      "view == redmine-clientActivityComments && (viewItem == redmineComment || viewItem == redmineCommentEditable)",
    );

    assert.ok(projectItem, "project activity item action must exist");
    assert.ok(ticketItem, "ticket activity item action must exist");
    assert.ok(commentItem, "comment activity item action must exist");
    assert.strictEqual(projectItem?.group, "inline@1");
    assert.strictEqual(ticketItem?.group, "inline@2");
    assert.strictEqual(commentItem?.group, "inline@1");
  });
});
