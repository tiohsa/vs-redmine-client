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
  test("addCommentFromComments command still exists in Command Palette", () => {
    const addCommand = findCommand("redmine-client.addCommentFromComments");
    assert.ok(addCommand, "redmine-client.addCommentFromComments command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: Add Comment");
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

  test("keeps existing comment commands", () => {
    const addComment = findCommand("redmine-client.addComment");
    assert.ok(addComment, "redmine-client.addComment command must exist");

    const editComment = findCommand("redmine-client.editComment");
    assert.ok(editComment, "redmine-client.editComment command must exist");
  });
});
