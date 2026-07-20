import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { initializeApiKeyStore, setApiKey } from "../config/apiKeyStore";
import { requestJson, runWithConnectionScope } from "../redmine/client";

suite("Redmine connection context", () => {
  test("APIキーを非同期処理開始時に固定する", async () => {
    let currentKey = "key-a";
    const secrets = {
      get: async () => currentKey,
      store: async (_key: string, value: string) => { currentKey = value; },
      delete: async () => { currentKey = ""; },
      onDidChange: () => ({ dispose: () => undefined }),
    } as unknown as vscode.SecretStorage;
    await initializeApiKeyStore(secrets, []);
    await setApiKey("key-a");

    const receivedKeys: string[] = [];
    const server = http.createServer((request, response) => {
      receivedKeys.push(request.headers["x-redmine-api-key"] as string);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };

    try {
      await runWithConnectionScope(`http://127.0.0.1:${address.port}`, async () => {
        await requestJson({ method: "GET", path: "/first" });
        await setApiKey("key-b");
        await requestJson({ method: "GET", path: "/second" });
      });
    } finally {
      await setApiKey("key-a");
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    assert.deepStrictEqual(receivedKeys, ["key-a", "key-a"]);
  });
});
