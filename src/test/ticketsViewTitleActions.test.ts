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
  test("createTicketFromList command still exists in Command Palette", () => {
    const addCommand = findCommand("redmine-client.createTicketFromList");
    assert.ok(addCommand, "redmine-client.createTicketFromList command must exist");
    assert.strictEqual(addCommand?.title, "Redmine: New Ticket");
  });

  test("createTicketFromList has no view/title entry (legacy view removed)", () => {
    const entry = findViewTitleEntry("redmine-client.createTicketFromList");
    assert.ok(!entry, "add ticket view/title entry must be removed");
  });

  test("refreshTickets has no view/title entry (legacy view removed)", () => {
    const entry = findViewTitleEntry("redmine-client.refreshTickets");
    assert.ok(!entry, "refresh tickets view/title entry must be removed");
  });

  test("declares ticket commands with icons", () => {
    const addCommand = findCommand("redmine-client.createTicketFromList");
    const refreshCommand = findCommand("redmine-client.refreshTickets");
    assert.ok(addCommand?.title, "add ticket command must include a title");
    assert.ok(refreshCommand?.title, "refresh tickets command must include a title");
    assert.ok(addCommand?.icon, "add ticket command must include an icon");
    assert.ok(refreshCommand?.icon, "refresh tickets command must include an icon");
  });

  test("uses new-file icon for ticket add action", () => {
    const addCommand = findCommand("redmine-client.createTicketFromList");
    assert.ok(addCommand, "add ticket command must exist");
    assert.strictEqual(addCommand?.icon, "$(add)");
  });

  test("declares child ticket action for Explorer ticket items", () => {
    const childCommand = findCommand("redmine-client.createChildTicketFromList");
    assert.ok(childCommand, "child ticket command must exist");
    assert.strictEqual(childCommand?.title, "Redmine: Add Child Ticket");
    assert.strictEqual(childCommand?.icon, "$(add)");

    const contextItems = getMenuItems("view/item/context");
    const explorerEntry = contextItems.find(
      (item) =>
        item.command === "redmine-client.createChildTicketFromList" &&
        item.when ===
        "view == redmine-clientTickets && viewItem == redmineTicket && redmine-client.canCreateTickets",
    );
    assert.ok(explorerEntry, "child ticket item action must exist in explorer view");
    assert.strictEqual(explorerEntry?.group, "inline@1");

    // レガシー Activity View のコンテキストメニューは削除済み
    const activityEntry = contextItems.find(
      (item) =>
        item.command === "redmine-client.createChildTicketFromList" &&
        item.when ===
        "view == redmine-clientActivityTickets && viewItem == redmineTicket && redmine-client.canCreateTickets",
    );
    assert.ok(!activityEntry, "legacy activity view child ticket action must be removed");
  });

  test("uses refresh icon for ticket reload action", () => {
    const reloadCommand = findCommand("redmine-client.reloadTicket");
    assert.ok(reloadCommand, "reload ticket command must exist");
    assert.strictEqual(reloadCommand?.icon, "$(refresh)");
  });

  test("collapseAllTickets command still exists (no legacy view/title entry)", () => {
    const collapseCommand = findCommand("redmine-client.collapseAllTickets");
    assert.ok(collapseCommand, "redmine-client.collapseAllTickets command must exist");
    assert.strictEqual(collapseCommand?.icon, "$(collapse-all)");

    const collapseEntry = findViewTitleEntry("redmine-client.collapseAllTickets");
    assert.ok(!collapseEntry, "collapse tickets view/title entry must be removed");
  });

  test("keeps existing ticket context actions for Explorer view", () => {
    const contextItems = getMenuItems("view/item/context");

    const openPreview = contextItems.find(
      (item) => item.command === "redmine-client.openTicketPreview",
    );
    assert.ok(openPreview, "open ticket preview menu item must exist");
    assert.strictEqual(openPreview?.when, "view == redmine-clientTickets && viewItem == redmineTicket");

    const openExtra = contextItems.find(
      (item) => item.command === "redmine-client.openExtraTicketEditor",
    );
    assert.ok(openExtra, "open extra ticket editor menu item must exist");
    assert.strictEqual(openExtra?.when, "view == redmine-clientTickets && viewItem == redmineTicket");
  });
});
