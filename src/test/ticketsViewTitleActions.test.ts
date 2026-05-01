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

  test("child ticket command still exists in Command Palette (no context menu after Dashboard migration)", () => {
    const childCommand = findCommand("redmine-client.createChildTicketFromList");
    assert.ok(childCommand, "child ticket command must exist");
    assert.strictEqual(childCommand?.title, "Redmine: Add Child Ticket");
    assert.strictEqual(childCommand?.icon, "$(add)");

    // Dashboard 移行により Explorer ビューのコンテキストメニューは削除済み
    const contextItems = getMenuItems("view/item/context");
    const explorerEntry = contextItems.find(
      (item) =>
        item.command === "redmine-client.createChildTicketFromList" &&
        item.when?.includes("redmine-clientTickets"),
    );
    assert.ok(!explorerEntry, "stale explorer view child ticket context menu must be removed after Dashboard migration");
  });

  test("uses refresh icon for ticket reload action", () => {
    const reloadCommand = findCommand("redmine-client.reloadTicket");
    assert.ok(reloadCommand, "reload ticket command must exist");
    assert.strictEqual(reloadCommand?.icon, "$(refresh)");
  });

  test("collapseAllTickets command is absent from contributes.commands (removed)", () => {
    const collapseCommand = findCommand("redmine-client.collapseAllTickets");
    assert.ok(!collapseCommand, "redmine-client.collapseAllTickets はユーザー向けコマンドとして残っていないこと");
  });

  test("stale Explorer view context menu entries are removed after Dashboard migration", () => {
    const contextItems = getMenuItems("view/item/context");

    // Dashboard 移行後、redmine-clientTickets を参照する stale エントリは削除済み
    const staleEntries = contextItems.filter(
      (item) => item.when?.includes("redmine-clientTickets"),
    );
    assert.strictEqual(staleEntries.length, 0, "no stale explorer view context menu entries should remain");
  });
});
