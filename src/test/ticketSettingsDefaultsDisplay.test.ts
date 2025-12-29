import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildTicketSettingsItemsFixture,
  createTicketsTreeProviderStub,
} from "./helpers/ticketSettingsViewStubs";
import { TicketSettingsTreeProvider } from "../views/ticketSettingsView";

suite("Ticket settings view", () => {
  test("excludes editor defaults from Activity Bar settings view", () => {
    const settingsItems = buildTicketSettingsItemsFixture();
    const provider = new TicketSettingsTreeProvider(
      createTicketsTreeProviderStub(settingsItems),
    );

    const children = provider.getChildren() as vscode.TreeItem[];
    assert.ok(Array.isArray(children));

    const labels = children.map((item) => String(item.label));
    assert.ok(labels.includes("Filter: Priority"));
    assert.ok(labels.every((label) => !label.startsWith("Editor default:")));
    assert.ok(labels.every((label) => label !== "Editor defaults: Reset"));
  });
});
