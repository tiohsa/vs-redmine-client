import * as assert from "assert";
import { clearViewContext, getViewContext, setViewContext } from "../views/viewContext";

suite("View context helpers", () => {
  teardown(() => {
    clearViewContext();
  });

  test("stores and retrieves context values", async () => {
    await setViewContext("redmine-client.testContext", true);

    assert.strictEqual(getViewContext("redmine-client.testContext"), true);
  });

  test("clears stored values", async () => {
    await setViewContext("redmine-client.testContext", "value");

    clearViewContext();

    assert.strictEqual(getViewContext("redmine-client.testContext"), undefined);
  });
});
