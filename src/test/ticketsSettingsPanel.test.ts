import * as assert from "assert";
import { TicketSettingsTreeProvider } from "../views/ticketSettingsView";
import { TicketSettingsItem, TicketsTreeProvider } from "../views/ticketsView";

suite("Ticket settings panel", () => {
  test("renders settings items in dedicated view", async () => {
    const ticketsProvider = new TicketsTreeProvider();
    const settingsProvider = new TicketSettingsTreeProvider(ticketsProvider);

    const items = (await settingsProvider.getChildren()) ?? [];

    assert.ok(items.length > 0);
    assert.ok(items[0] instanceof TicketSettingsItem);
  });
});
