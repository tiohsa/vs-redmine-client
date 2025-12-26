import * as assert from "assert";
import { validateComment } from "../utils/commentValidation";

suite("Comment validation", () => {
  test("rejects whitespace-only input", () => {
    const result = validateComment("   ");

    assert.strictEqual(result.valid, false);
  });

  test("rejects over length limit", () => {
    const input = "a".repeat(20001);
    const result = validateComment(input);

    assert.strictEqual(result.valid, false);
  });

  test("accepts valid input", () => {
    const result = validateComment("Looks good");

    assert.strictEqual(result.valid, true);
  });
});
