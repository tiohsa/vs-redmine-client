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
    const addCommand = findCommand("todoex.addCommentFromComments");
    assert.ok(addCommand, "todoex.addCommentFromComments command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: Add Comment");

    const entry = findViewTitleEntry("todoex.addCommentFromComments");
    assert.ok(entry, "add comment view/title entry must exist");
    assert.strictEqual(entry?.when, "view == todoexActivityComments");
    assert.strictEqual(entry?.enablement, "todoex.canAddComments");
  });

  test("declares comment view title icons and tooltip sources", () => {
    const addCommand = findCommand("todoex.addCommentFromComments");
    const reloadCommand = findCommand("todoex.reloadComment");
    assert.ok(addCommand?.title, "add comment command must include a title");
    assert.ok(reloadCommand?.title, "reload comment command must include a title");
    assert.ok(addCommand?.icon, "add comment command must include an icon");
    assert.ok(reloadCommand?.icon, "reload comment command must include an icon");

    const addEntry = findViewTitleEntry("todoex.addCommentFromComments");
    const reloadEntry = findViewTitleEntry("todoex.reloadComment");
    assert.ok(addEntry, "add comment view/title entry must exist");
    assert.ok(reloadEntry, "reload comment view/title entry must exist");
  });

  test("uses new-file icon for comment add action", () => {
    const addCommand = findCommand("todoex.addCommentFromComments");
    assert.ok(addCommand, "add comment command must exist");
    assert.strictEqual(addCommand?.icon, "$(add)");
  });

  test("uses refresh icon for comment reload action", () => {
    const reloadCommand = findCommand("todoex.reloadComment");
    assert.ok(reloadCommand, "reload comment command must exist");
    assert.strictEqual(reloadCommand?.icon, "$(refresh)");
  });

  test("keeps existing comment commands", () => {
    const addComment = findCommand("todoex.addComment");
    assert.ok(addComment, "todoex.addComment command must exist");

    const editComment = findCommand("todoex.editComment");
    assert.ok(editComment, "todoex.editComment command must exist");
  });
});
