import * as assert from "assert";
import * as vscode from "vscode";
import {
  CommandItem,
  getCommands,
  getViewTitleMenuItems,
  loadNls,
  MenuItem,
  resolveNls,
} from "./helpers/packageJson";

const nls = loadNls();

const retiredCommands = new Set([
  "redmine-client.addComment",
  "redmine-client.loadMoreTickets",
  "redmine-client.toggleRelevantTickets",
  "redmine-client.configureTicketTitleFilter",
  "redmine-client.configureTicketPriorityFilter",
  "redmine-client.configureTicketStatusFilter",
  "redmine-client.configureTicketTrackerFilter",
  "redmine-client.configureTicketAssigneeFilter",
  "redmine-client.configureTicketSort",
  "redmine-client.configureTicketDueDateDisplay",
  "redmine-client.resetTicketListSettings",
]);

const findCommand = (commandId: string): CommandItem | undefined =>
  getCommands().find((command) => command.command === commandId);

const findViewTitleEntry = (commandId: string): MenuItem | undefined =>
  getViewTitleMenuItems().find((item) => item.command === commandId);

suite("Comments view title actions", () => {
  test("addCommentFromComments command still exists in Command Palette", () => {
    const addCommand = findCommand("redmine-client.addCommentFromComments");
    assert.ok(addCommand, "redmine-client.addCommentFromComments command must exist");
    assert.strictEqual(resolveNls(addCommand?.title ?? "", nls), "Redmine: Add Comment");
    assert.strictEqual(resolveNls(addCommand?.title ?? "", loadNls("ja")), "Redmine: コメントを追加");
  });

  test("addCommentFromComments has no view/title entry (legacy view removed)", () => {
    const entry = findViewTitleEntry("redmine-client.addCommentFromComments");
    assert.ok(!entry, "add comment view/title entry must be removed");
  });

  test("refreshComments has no view/title entry (legacy view removed)", () => {
    const entry = findViewTitleEntry("redmine-client.refreshComments");
    assert.ok(!entry, "refresh comments view/title entry must be removed");
  });

  test("uses new-file icon for comment add action", () => {
    const addCommand = findCommand("redmine-client.addCommentFromComments");
    assert.ok(addCommand, "add comment command must exist");
    assert.strictEqual(addCommand?.icon, "$(add)");
  });

  test("uses refresh icon for comment reload action", () => {
    const reloadCommand = findCommand("redmine-client.reloadComment");
    assert.ok(reloadCommand, "reload comment command must exist");
    assert.strictEqual(reloadCommand?.icon, "$(refresh)");
  });

  test("keeps the editComment command", () => {
    const editComment = findCommand("redmine-client.editComment");
    assert.ok(editComment, "redmine-client.editComment command must exist");
  });
});

suite("Guidance-only commands", () => {
  test("omits retired Dashboard guidance commands from the manifest", () => {
    const contributedCommands = getCommands().map(({ command }) => command);
    assert.deepStrictEqual(contributedCommands.filter((id) => retiredCommands.has(id)), []);
  });

  test("does not register the retired Dashboard guidance commands", async () => {
    const extension = vscode.extensions.getExtension("tiohsa.redmine-client");
    assert.ok(extension);
    await extension.activate();

    const registeredCommands = await vscode.commands.getCommands();
    assert.deepStrictEqual(registeredCommands.filter((id) => retiredCommands.has(id)), []);
  });
});
