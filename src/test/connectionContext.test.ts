import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { initializeApiKeyStore, setApiKey } from "../config/apiKeyStore";
import { requestJson, requestText, runWithConnectionScope } from "../redmine/client";

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

suite("Redmine HTTP response limits", () => {
  const limit = 10 * 1024 * 1024;
  const withServer = async (handler: http.RequestListener, check: () => Promise<void>): Promise<void> => {
    const secrets = {
      get: async () => "test-response-key",
      store: async () => undefined,
      delete: async () => undefined,
      onDidChange: () => ({ dispose: () => undefined }),
    } as unknown as vscode.SecretStorage;
    await initializeApiKeyStore(secrets, []);
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      await runWithConnectionScope(`http://127.0.0.1:${address.port}`, check);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };

  test("上限ちょうどのUTF-8応答は受け入れる", async () => {
    const body = "é".repeat(limit / 2);
    await withServer((_request, response) => response.end(body), async () => {
      assert.strictEqual(await requestText({ method: "GET", path: "/boundary" }), body);
    });
  });

  for (const chunked of [false, true]) {
    test(`${chunked ? "chunked" : "Content-Length付き"}応答の上限超過で要求を中止する`, async () => {
      const body = Buffer.alloc(limit + 1, "x");
      let markClosed!: () => void;
      const closed = new Promise<void>((resolve) => { markClosed = resolve; });
      await withServer((_request, response) => {
        response.on("close", markClosed);
        // 応答完了を待たず、クライアントが超過時点で接続を閉じることを確認する。
        if (!chunked) { response.setHeader("Content-Length", body.length + 1); }
        response.write(body.subarray(0, limit));
        response.write(body.subarray(limit));
      }, async () => {
        await assert.rejects(
          requestJson({ method: "GET", path: "/oversized" }),
          { message: vscode.l10n.t("Redmine response exceeded the maximum size of {0} MiB.", 10) },
        );
        await closed;
      });
    });
  }

  test("更新後の応答サイズ超過でもPUTを再送せず秘密情報をエラーへ含めない", async () => {
    let requests = 0;
    await withServer((_request, response) => {
      requests++;
      response.end(Buffer.alloc(limit + 1, "x"));
    }, async () => {
      await assert.rejects(requestText({ method: "PUT", path: "/update", body: "private-body" }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, vscode.l10n.t("Redmine response exceeded the maximum size of {0} MiB.", 10));
        assert.ok(!error.message.includes("private-body"));
        assert.ok(!error.message.includes("test-response-key"));
        return true;
      });
    });
    assert.strictEqual(requests, 1);
  });

  test("応答途中の切断は完了待ちにならずrejectする", async () => {
    await withServer((_request, response) => {
      response.setHeader("Content-Length", 100);
      response.write("{", () => response.destroy());
    }, async () => {
      await assert.rejects(requestJson({ method: "GET", path: "/aborted" }));
    });
  });

  test("上限内のJSONとHTTPエラーの既存の扱いを維持する", async () => {
    await withServer((request, response) => {
      if (request.url === "/invalid") {
        response.writeHead(422);
        response.end("validation failure");
      } else { response.end('{"ok":true}'); }
    }, async () => {
      assert.deepStrictEqual(await requestJson({ method: "GET", path: "/ok" }), { ok: true });
      await assert.rejects(requestJson({ method: "GET", path: "/invalid" }), /Redmine request failed \(422\): validation failure/);
    });
  });
});
