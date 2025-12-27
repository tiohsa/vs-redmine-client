import * as assert from "assert";
import { getCommentSaveNotification } from "../views/commentSaveNotifications";

suite("Comment save notifications", () => {
  test("returns no notification for no_change", () => {
    const notification = getCommentSaveNotification({
      status: "no_change",
      message: "No changes",
    });

    assert.strictEqual(notification, undefined);
  });

  test("maps success to info", () => {
    const notification = getCommentSaveNotification({
      status: "success",
      message: "Updated",
    });

    assert.deepStrictEqual(notification, {
      type: "info",
      message: "Comment updated.",
    });
  });

  test("maps created to info", () => {
    const notification = getCommentSaveNotification({
      status: "created",
      message: "Added",
    });

    assert.deepStrictEqual(notification, {
      type: "info",
      message: "Comment added.",
    });
  });
});
