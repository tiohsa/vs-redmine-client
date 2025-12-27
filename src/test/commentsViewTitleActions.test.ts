import * as assert from "assert";
import { loadPackageJson } from "./helpers/packageJson";

type MenuItem = {
  command: string;
  when?: string;
  group?: string;
  enablement?: string;
};

type CommandItem = {
  command: string;
  title?: string;
};

suite("Comments view title actions", () => {
  test("declares add comment command and view title action", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const commands = contributes.commands as CommandItem[] | undefined;
    assert.ok(commands, "commands must be defined");
    const addCommand = commands.find(
      (command) => command.command === "todoex.addCommentFromComments",
    );
    assert.ok(addCommand, "todoex.addCommentFromComments command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: Add Comment");

    const menus = contributes.menus as Record<string, MenuItem[]> | undefined;
    assert.ok(menus, "menus must be defined");
    const viewTitle = menus["view/title"] as MenuItem[] | undefined;
    assert.ok(viewTitle, "view/title menu must be defined");
    const entry = viewTitle.find(
      (item) => item.command === "todoex.addCommentFromComments",
    );
    assert.ok(entry, "add comment view/title entry must exist");
    assert.strictEqual(entry?.when, "view == todoexActivityComments");
    assert.strictEqual(entry?.enablement, "todoex.canAddComments");
  });

  test("keeps existing comment commands", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const commands = contributes.commands as CommandItem[] | undefined;
    assert.ok(commands, "commands must be defined");

    const addComment = commands.find(
      (command) => command.command === "todoex.addComment",
    );
    assert.ok(addComment, "todoex.addComment command must exist");

    const editComment = commands.find(
      (command) => command.command === "todoex.editComment",
    );
    assert.ok(editComment, "todoex.editComment command must exist");
  });
});
