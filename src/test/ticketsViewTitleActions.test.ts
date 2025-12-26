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

suite("Tickets view title actions", () => {
  test("declares add ticket command and view title action", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const commands = contributes.commands as CommandItem[] | undefined;
    assert.ok(commands, "commands must be defined");
    const addCommand = commands.find(
      (command) => command.command === "todoex.createTicketFromList",
    );
    assert.ok(addCommand, "todoex.createTicketFromList command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: New Ticket");

    const menus = contributes.menus as Record<string, MenuItem[]> | undefined;
    assert.ok(menus, "menus must be defined");
    const viewTitle = menus["view/title"] as MenuItem[] | undefined;
    assert.ok(viewTitle, "view/title menu must be defined");
    const entry = viewTitle.find(
      (item) => item.command === "todoex.createTicketFromList",
    );
    assert.ok(entry, "add ticket view/title entry must exist");
    assert.strictEqual(entry?.when, "view == todoexActivityTickets");
    assert.strictEqual(entry?.enablement, "todoex.canCreateTickets");
  });

  test("keeps existing ticket context actions", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const menus = contributes.menus as Record<string, MenuItem[]> | undefined;
    assert.ok(menus, "menus must be defined");
    const contextItems = menus["view/item/context"] as MenuItem[] | undefined;
    assert.ok(contextItems, "view/item/context menu must be defined");

    const openPreview = contextItems.find(
      (item) => item.command === "todoex.openTicketPreview",
    );
    assert.ok(openPreview, "open ticket preview menu item must exist");
    assert.strictEqual(openPreview?.when, "view == todoexTickets && viewItem == redmineTicket");

    const openExtra = contextItems.find(
      (item) => item.command === "todoex.openExtraTicketEditor",
    );
    assert.ok(openExtra, "open extra ticket editor menu item must exist");
    assert.strictEqual(openExtra?.when, "view == todoexTickets && viewItem == redmineTicket");
  });
});
