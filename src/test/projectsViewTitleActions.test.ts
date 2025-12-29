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

suite("Projects view title actions", () => {
  test("declares collapse command and view title action", () => {
    const collapseCommand = findCommand("redmine-client.collapseAllProjects");
    assert.ok(collapseCommand, "redmine-client.collapseAllProjects command must exist");

    const collapseEntry = findViewTitleEntry("redmine-client.collapseAllProjects");
    assert.ok(collapseEntry, "collapse projects view/title entry must exist");
    assert.strictEqual(collapseEntry?.when, "view == redmine-clientActivityProjects");
  });

  test("uses collapse icon for projects action", () => {
    const collapseCommand = findCommand("redmine-client.collapseAllProjects");
    assert.ok(collapseCommand, "collapse projects command must exist");
    assert.ok(collapseCommand?.icon, "collapse projects command must include an icon");
    assert.strictEqual(collapseCommand?.icon, "$(collapse-all)");
  });
});
