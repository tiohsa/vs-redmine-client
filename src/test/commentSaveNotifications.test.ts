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

  test("maps created_unresolved to warning", () => {
    const notification = getCommentSaveNotification({
      status: "created_unresolved",
      message: "Comment added, but ID missing.",
    });

    assert.deepStrictEqual(notification, {
      type: "warning",
      message: "Comment added, but ID missing.",
    });
  });

  test("maps upload failures to warning", () => {
    const notification = getCommentSaveNotification({
      status: "success",
      message: "Updated",
      uploadSummary: {
        permissionDenied: false,
        failures: [{ path: "./bad.png", reason: "Missing file" }],
      },
    });

    assert.deepStrictEqual(notification, {
      type: "warning",
      message: "Saved with upload failures. Failed images: ./bad.png.",
    });
  });
});
