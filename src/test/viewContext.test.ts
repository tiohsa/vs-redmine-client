import * as assert from "assert";
import { clearViewContext, getViewContext, setViewContext } from "../views/viewContext";

suite("View context helpers", () => {
  teardown(() => {
    clearViewContext();
  });

  test("stores and retrieves context values", async () => {
    await setViewContext("todoex.testContext", true);

    assert.strictEqual(getViewContext("todoex.testContext"), true);
  });

  test("clears stored values", async () => {
    await setViewContext("todoex.testContext", "value");

    clearViewContext();

    assert.strictEqual(getViewContext("todoex.testContext"), undefined);
  });
});
