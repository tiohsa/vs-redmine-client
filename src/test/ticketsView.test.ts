import * as assert from "assert";
import { TicketTreeItem, TicketsTreeProvider } from "../views/ticketsView";

const resolveItems = async (provider: TicketsTreeProvider): Promise<unknown[]> => {
  const result = await Promise.resolve(provider.getChildren());
  return result ?? [];
};

suite("Tickets view updates", () => {
  test("notifies listeners when a subject update is applied", () => {
    const provider = new TicketsTreeProvider();
    provider.setTicketsState([{ id: 1, subject: "Old", projectId: 1 }], 1);

    let fired = 0;
    const disposable = provider.onDidChangeTreeData(() => {
      fired += 1;
    });

    const updated = provider.updateTicketSubject(1, "New");

    assert.strictEqual(updated, true);
    assert.strictEqual(fired, 1);

    disposable.dispose();
  });

  test("keeps item order when updating a subject", async () => {
    const provider = new TicketsTreeProvider();
    provider.setTicketsState(
      [
        { id: 1, subject: "First", projectId: 1 },
        { id: 2, subject: "Second", projectId: 1 },
      ],
      1,
    );

    const beforeItems = await resolveItems(provider);
    const beforeIds = beforeItems.map((item) => (item as { id?: string }).id);

    provider.updateTicketSubject(2, "Updated");

    const afterItems = await resolveItems(provider);
    const afterIds = afterItems.map((item) => (item as { id?: string }).id);
    const updatedItem = afterItems.find(
      (item) => (item as { id?: string }).id === "2",
    );

    assert.deepStrictEqual(afterIds, beforeIds);
    assert.ok(updatedItem instanceof TicketTreeItem);
    assert.strictEqual((updatedItem as TicketTreeItem).ticket.subject, "Updated");
  });
});
