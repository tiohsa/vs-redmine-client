import * as assert from "assert";
import { isProjectNameMatch } from "../utils/templateMatcher";

suite("Template name matcher", () => {
  test("matches project name case-insensitively within file name", () => {
    assert.strictEqual(isProjectNameMatch("Project Alpha.md", "project alpha"), true);
    assert.strictEqual(isProjectNameMatch("alpha-template.md", "ALPHA"), true);
  });

  test("does not match when project name is empty", () => {
    assert.strictEqual(isProjectNameMatch("Project Alpha.md", ""), false);
    assert.strictEqual(isProjectNameMatch("Project Alpha.md", "   "), false);
  });
});
