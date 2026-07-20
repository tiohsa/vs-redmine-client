import * as assert from "assert";
import { getConnectionScope } from "../config/connectionScope";

suite("Redmine connection scope", () => {
  test("末尾スラッシュだけが異なるbaseUrlは同じ接続先として扱う", () => {
    assert.strictEqual(
      getConnectionScope("https://example.com/redmine"),
      getConnectionScope("https://example.com/redmine/"),
    );
  });

  test("異なるサブパスは別接続先として扱う", () => {
    assert.notStrictEqual(
      getConnectionScope("https://example.com/redmine-a"),
      getConnectionScope("https://example.com/redmine-b"),
    );
  });
});
