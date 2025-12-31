import * as assert from "assert";
import {
  CommandItem,
  getCommands,
  getViewTitleMenuItems,
  MenuItem,
} from "./helpers/packageJson";

const findCommand = (commandId: string): CommandItem | undefined =>
  getCommands().find((command) => command.command === commandId);

const findViewTitleEntry = (commandId: string): MenuItem | undefined =>
  getViewTitleMenuItems().find((item) => item.command === commandId);

suite("Comments view title actions", () => {
  test("declares add comment command and view title action", () => {
    const addCommand = findCommand("redmine-client.addCommentFromComments");
    assert.ok(addCommand, "redmine-client.addCommentFromComments command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: Add Comment");

    const entry = findViewTitleEntry("redmine-client.addCommentFromComments");
    assert.ok(entry, "add comment view/title entry must exist");
    assert.strictEqual(entry?.when, "view == redmine-clientActivityComments");
    assert.strictEqual(entry?.enablement, "redmine-client.canAddComments");
  });

  test("declares comment view title icons and tooltip sources", () => {
    const addCommand = findCommand("redmine-client.addCommentFromComments");
    const refreshCommand = findCommand("redmine-client.refreshComments");
    assert.ok(addCommand?.title, "add comment command must include a title");
    assert.ok(refreshCommand?.title, "refresh comments command must include a title");
    assert.ok(addCommand?.icon, "add comment command must include an icon");
    assert.ok(refreshCommand?.icon, "refresh comments command must include an icon");

    const addEntry = findViewTitleEntry("redmine-client.addCommentFromComments");
    const refreshEntry = findViewTitleEntry("redmine-client.refreshComments");
    assert.ok(addEntry, "add comment view/title entry must exist");
    assert.ok(refreshEntry, "refresh comments view/title entry must exist");
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

  test("keeps existing comment commands", () => {
    const addComment = findCommand("redmine-client.addComment");
    assert.ok(addComment, "redmine-client.addComment command must exist");

    const editComment = findCommand("redmine-client.editComment");
    assert.ok(editComment, "redmine-client.editComment command must exist");
  });
});
