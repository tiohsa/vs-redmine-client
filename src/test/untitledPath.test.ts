import * as assert from "assert";
import { buildUniqueUntitledName } from "../views/untitledPath";

suite("Untitled name builder", () => {
  test("returns original name when not taken", () => {
    const name = buildUniqueUntitledName("draft.md", () => false);
    assert.strictEqual(name, "draft.md");
  });

  test("adds suffix when name is taken", () => {
    const taken = new Set(["draft.md"]);
    const name = buildUniqueUntitledName("draft.md", (candidate) => taken.has(candidate));
    assert.strictEqual(name, "draft-1.md");
  });

  test("adds suffix for names without extension", () => {
    const taken = new Set(["draft", "draft-1"]);
    const name = buildUniqueUntitledName("draft", (candidate) => taken.has(candidate));
    assert.strictEqual(name, "draft-2");
  });
});
