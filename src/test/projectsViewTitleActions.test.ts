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
  test("collapseAllProjects command still exists in Command Palette", () => {
    const collapseCommand = findCommand("redmine-client.collapseAllProjects");
    assert.ok(collapseCommand, "redmine-client.collapseAllProjects command must exist");
  });

  test("collapseAllProjects has no view/title entry (legacy view removed)", () => {
    const collapseEntry = findViewTitleEntry("redmine-client.collapseAllProjects");
    assert.ok(!collapseEntry, "collapse projects view/title entry must be removed");
  });

  test("runOfflineSync command still exists in Command Palette", () => {
    const syncCommand = findCommand("redmine-client.runOfflineSync");
    assert.ok(syncCommand, "redmine-client.runOfflineSync command must exist");
  });

  test("runOfflineSync has no legacy view/title entry (legacy view removed)", () => {
    const legacyEntry = findViewTitleEntry("redmine-client.runOfflineSync");
    assert.ok(!legacyEntry, "offline sync view/title entry for legacy Projects view must be removed");
  });

  test("uses cloud icon for offline sync action", () => {
    const syncCommand = findCommand("redmine-client.runOfflineSync");
    assert.ok(syncCommand, "offline sync command must exist");
    assert.ok(syncCommand?.icon, "offline sync command must include an icon");
    assert.strictEqual(syncCommand?.icon, "$(cloud-upload)");
  });
});
