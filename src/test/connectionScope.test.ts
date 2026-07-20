import * as assert from "assert";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getConnectionScope,
  getConnectionScopeHash,
} from "../config/connectionScope";

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

  test("接続スコープハッシュは決定的でパスに安全", () => {
    const scope = getConnectionScope("https://example.com/redmine");
    const first = getConnectionScopeHash(scope);
    const second = getConnectionScopeHash(scope);

    assert.strictEqual(first, second);
    assert.match(first, /^[a-f0-9]{16}$/);
    assert.notStrictEqual(
      first,
      getConnectionScopeHash(getConnectionScope("https://other.example/redmine")),
    );
  });

  test("接続先不一致メッセージは同期経路で共通利用できる", () => {
    assert.strictEqual(
      CONNECTION_SCOPE_MISMATCH_MESSAGE,
      "This editor belongs to another Redmine connection. Switch back to the original connection before syncing.",
    );
  });
});
