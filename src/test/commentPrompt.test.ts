import * as assert from "assert";
import { validateComment } from "../utils/commentValidation";

suite("Comment prompt behavior", () => {
  test("keeps input on validation failure", () => {
    const result = validateComment(" ");

    assert.strictEqual(result.valid, false);
  });
});
