import * as assert from "assert";
import {
  CommandItem,
  getCommands,
  getMenuItems,
  getViewTitleMenuItems,
  MenuItem,
} from "./helpers/packageJson";

const findCommand = (commandId: string): CommandItem | undefined =>
  getCommands().find((command) => command.command === commandId);

const findViewTitleEntry = (commandId: string): MenuItem | undefined =>
  getViewTitleMenuItems().find((item) => item.command === commandId);

suite("Tickets view title actions", () => {
  test("declares add ticket command and view title action", () => {
    const addCommand = findCommand("todoex.createTicketFromList");
    assert.ok(addCommand, "todoex.createTicketFromList command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: New Ticket");

    const entry = findViewTitleEntry("todoex.createTicketFromList");
    assert.ok(entry, "add ticket view/title entry must exist");
    assert.strictEqual(entry?.when, "view == todoexActivityTickets");
    assert.strictEqual(entry?.enablement, "todoex.canCreateTickets");
  });

  test("declares ticket view title icons and tooltip sources", () => {
    const addCommand = findCommand("todoex.createTicketFromList");
    const reloadCommand = findCommand("todoex.reloadTicket");
    assert.ok(addCommand?.title, "add ticket command must include a title");
    assert.ok(reloadCommand?.title, "reload ticket command must include a title");
    assert.ok(addCommand?.icon, "add ticket command must include an icon");
    assert.ok(reloadCommand?.icon, "reload ticket command must include an icon");

    const addEntry = findViewTitleEntry("todoex.createTicketFromList");
    const reloadEntry = findViewTitleEntry("todoex.reloadTicket");
    assert.ok(addEntry, "add ticket view/title entry must exist");
    assert.ok(reloadEntry, "reload ticket view/title entry must exist");
  });

  test("uses new-file icon for ticket add action", () => {
    const addCommand = findCommand("todoex.createTicketFromList");
    assert.ok(addCommand, "add ticket command must exist");
    assert.strictEqual(addCommand?.icon, "$(add)");
  });

  test("uses refresh icon for ticket reload action", () => {
    const reloadCommand = findCommand("todoex.reloadTicket");
    assert.ok(reloadCommand, "reload ticket command must exist");
    assert.strictEqual(reloadCommand?.icon, "$(refresh)");
  });

  test("keeps existing ticket context actions", () => {
    const contextItems = getMenuItems("view/item/context");

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
