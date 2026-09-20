import * as assert from "assert";
import * as vscode from "vscode";
import {
  initializeApiKeyStore, resolveApiKeyForScope, setApiKeyForScope, clearApiKeyForScope,
  resolveApiKey, isApiKeyConfigured, getApiKeyStatus,
} from "../config/apiKeyStore";
import { getConnectionScope, getConnectionScopeHash } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { withConfiguration } from "./helpers/configuration";
import { MemorySecretStorage } from "./helpers/secretStorage";

const a = "https://a.example/redmine/";
const b = "https://b.example/redmine/";
const legacyKey = "redmine-client.apiKey";
const secretKey = (scope: string): string => `${legacyKey}:${getConnectionScopeHash(getConnectionScope(scope))}`;

suite("API key connection scope", () => {
  let secrets: MemorySecretStorage;
  let subscriptions: vscode.Disposable[];
  setup(() => {
    secrets = new MemorySecretStorage();
    subscriptions = [];
  });
  teardown(() => {
    subscriptions.forEach((subscription) => subscription.dispose());
    secrets.dispose();
  });
  const initialize = (): Promise<void> => initializeApiKeyStore(secrets, subscriptions);

  test("scoped SecretStorage と同期 UI は A/B の保存・削除・再初期化で分離する", async () => {
    await initialize();
    await setApiKeyForScope(a, "KEY-A");
    await setApiKeyForScope(b, "KEY-B");
    await initialize();
    assert.strictEqual(await resolveApiKeyForScope("https://A.example/redmine"), "KEY-A");
    await runWithConnectionScope(a, async () => {
      assert.strictEqual(resolveApiKey(), "KEY-A");
      assert.strictEqual(isApiKeyConfigured(), true);
      assert.strictEqual(await getApiKeyStatus(), "secret");
    });
    await clearApiKeyForScope(a);
    assert.strictEqual(await resolveApiKeyForScope(a), "");
    assert.strictEqual(await resolveApiKeyForScope(b), "KEY-B");
    await runWithConnectionScope(a, async () => {
      assert.strictEqual(isApiKeyConfigured(), false);
      assert.strictEqual(await getApiKeyStatus(), "none");
    });
    assert.strictEqual(secrets.values.has(legacyKey), false);
  });

  test("legacy は初期化時の設定先へ一度だけ移行し nested scope へ渡さない", async () => {
    secrets.values.set(legacyKey, "LEGACY");
    await withConfiguration("baseUrl", a, () => runWithConnectionScope(b, initialize));
    assert.strictEqual(await resolveApiKeyForScope(a), "LEGACY");
    assert.strictEqual(await resolveApiKeyForScope(b), "");
    assert.strictEqual(secrets.values.has(legacyKey), false);
    await withConfiguration("baseUrl", b, initialize);
    assert.strictEqual(await resolveApiKeyForScope(b), "");
  });

  test("既存 scoped key は legacy で上書きしない", async () => {
    secrets.values.set(legacyKey, "LEGACY");
    secrets.values.set(secretKey(a), "KEY-A");
    secrets.values.set(secretKey(b), "KEY-B");
    await withConfiguration("baseUrl", a, initialize);
    assert.strictEqual(await resolveApiKeyForScope(a), "KEY-A");
    assert.strictEqual(await resolveApiKeyForScope(b), "KEY-B");
  });

  test("別 scope の既存 key を保持して現在 scope だけに移行する", async () => {
    secrets.values.set(legacyKey, "LEGACY");
    secrets.values.set(secretKey(b), "KEY-B");
    await withConfiguration("baseUrl", a, initialize);
    assert.strictEqual(await resolveApiKeyForScope(a), "LEGACY");
    assert.strictEqual(await resolveApiKeyForScope(b), "KEY-B");
  });

  for (const invalid of ["", "invalid-url", "file:///tmp/redmine"]) {
    test(`無効な設定 ${JSON.stringify(invalid)} では legacy を保持する`, async () => {
      secrets.values.set(legacyKey, "LEGACY");
      await withConfiguration("baseUrl", invalid, initialize);
      assert.deepStrictEqual([...secrets.values], [[legacyKey, "LEGACY"]]);
      assert.strictEqual(await resolveApiKeyForScope(b), "");
    });
  }

  for (const failure of ["store", "delete"] as const) {
    test(`移行 ${failure} 失敗後に B へコピーせず A で再開できる`, async () => {
      secrets.values.set(legacyKey, "LEGACY");
      const originalStore = secrets.store.bind(secrets);
      const originalDelete = secrets.delete.bind(secrets);
      if (failure === "store") {
        secrets.store = async (key, value) => {
          if (key === secretKey(a)) { throw new Error("storage failure"); }
          await originalStore(key, value);
        };
      } else {
        secrets.delete = async () => { throw new Error("storage failure"); };
      }
      await withConfiguration("baseUrl", a, () => assert.rejects(initialize(), /storage failure/));
      secrets.store = originalStore;
      secrets.delete = originalDelete;
      await withConfiguration("baseUrl", b, initialize);
      assert.strictEqual(await resolveApiKeyForScope(b), "");
      assert.strictEqual(secrets.values.get(legacyKey), "LEGACY");
      await withConfiguration("baseUrl", a, initialize);
      assert.strictEqual(await resolveApiKeyForScope(a), "LEGACY");
      assert.strictEqual(secrets.values.has(legacyKey), false);
    });
  }

  test("同時初期化でも legacy を複数接続先へ移行しない", async () => {
    secrets.values.set(legacyKey, "LEGACY");
    await withConfiguration("baseUrl", a, async () => {
      await Promise.all([initialize(), initialize()]);
    });
    await withConfiguration("baseUrl", b, initialize);
    assert.strictEqual(await resolveApiKeyForScope(a), "LEGACY");
    assert.strictEqual(await resolveApiKeyForScope(b), "");
  });
});
