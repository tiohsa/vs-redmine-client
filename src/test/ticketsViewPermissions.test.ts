import * as assert from "assert";
import { clearViewContext, getViewContext } from "../views/viewContext";
import {
  CREATE_TICKET_CONTEXT_KEY,
  evaluateCreateTicketPermission,
  refreshCreateTicketContext,
} from "../views/ticketsView";

suite("Tickets view permissions", () => {
  teardown(() => {
    clearViewContext();
  });

  test("evaluates create ticket permission based on settings", () => {
    assert.strictEqual(evaluateCreateTicketPermission("https://example", "key"), true);
    assert.strictEqual(evaluateCreateTicketPermission("", "key"), false);
    assert.strictEqual(evaluateCreateTicketPermission("https://example", ""), false);
  });

  test("refreshes create ticket context", () => {
    refreshCreateTicketContext("https://example", "key");

    assert.strictEqual(getViewContext(CREATE_TICKET_CONTEXT_KEY), true);
  });
});
