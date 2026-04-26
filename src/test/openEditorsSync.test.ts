import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const loadPackageJson = (): Record<string, unknown> => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
};

type MenuEntry = { command: string; when?: string; group?: string };
type CommandEntry = { command: string; title: string; icon?: string };

const getMenus = (
  packageJson: Record<string, unknown>,
): Record<string, MenuEntry[]> => {
  const contributes = packageJson.contributes as Record<string, unknown>;
  return (contributes?.menus ?? {}) as Record<string, MenuEntry[]>;
};

const getCommands = (packageJson: Record<string, unknown>): CommandEntry[] => {
  const contributes = packageJson.contributes as Record<string, unknown>;
  return (contributes?.commands ?? []) as CommandEntry[];
};

suite("Open Editors sync — package.json contributions", () => {
  test("syncToRedmine is not in editor/title", () => {
    const menus = getMenus(loadPackageJson());
    const editorTitle: MenuEntry[] = (menus["editor/title"] ?? []) as MenuEntry[];
    const found = editorTitle.some(
      (e) => e.command === "redmine-client.syncToRedmine",
    );
    assert.strictEqual(found, false, "syncToRedmine must not appear in editor/title");
  });

  test("syncOpenEditor is no longer tied to redmine-clientActivityOpenTickets", () => {
    const menus = getMenus(loadPackageJson());
    const itemContext: MenuEntry[] = (menus["view/item/context"] ?? []) as MenuEntry[];
    const entry = itemContext.find(
      (e) =>
        e.command === "redmine-client.syncOpenEditor" &&
        e.when?.includes("redmine-clientActivityOpenTickets"),
    );
    assert.ok(!entry, "syncOpenEditor must not target the removed redmine-clientActivityOpenTickets view");
  });

  test("runOfflineSync has no legacy view/title entry (UnsyncedFiles view removed)", () => {
    const menus = getMenus(loadPackageJson());
    const viewTitle: MenuEntry[] = (menus["view/title"] ?? []) as MenuEntry[];
    const entry = viewTitle.find(
      (e) => e.command === "redmine-client.runOfflineSync" &&
        e.when?.includes("redmine-clientActivityUnsyncedFiles"),
    );
    assert.ok(!entry, "legacy runOfflineSync view/title for UnsyncedFiles must be removed");
  });

  test("syncOpenEditor command has cloud-upload icon", () => {
    const commands = getCommands(loadPackageJson());
    const entry = commands.find((c) => c.command === "redmine-client.syncOpenEditor");
    assert.ok(entry, "redmine-client.syncOpenEditor command must be declared");
    assert.strictEqual(entry?.icon, "$(cloud-upload)");
  });

  test("syncAllOpenEditors command has cloud-upload icon", () => {
    const commands = getCommands(loadPackageJson());
    const entry = commands.find(
      (c) => c.command === "redmine-client.syncAllOpenEditors",
    );
    assert.ok(entry, "redmine-client.syncAllOpenEditors command must be declared");
    assert.strictEqual(entry?.icon, "$(cloud-upload)");
  });
});
