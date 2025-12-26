import * as assert from "assert";
import { getSaveNotification } from "../views/ticketSaveNotifications";

suite("Ticket save notifications", () => {
  test("returns no notification for no_change", () => {
    const notification = getSaveNotification({
      status: "no_change",
      message: "No changes",
    });

    assert.strictEqual(notification, undefined);
  });

  test("maps success to info", () => {
    const notification = getSaveNotification({
      status: "success",
      message: "Updated",
    });

    assert.deepStrictEqual(notification, {
      type: "info",
      message: "Redmine updated.",
    });
  });

  test("maps conflict to warning", () => {
    const notification = getSaveNotification({
      status: "conflict",
      message: "Conflict",
    });

    assert.deepStrictEqual(notification, {
      type: "warning",
      message: "Remote changes detected. Refresh before saving.",
    });
  });
});
