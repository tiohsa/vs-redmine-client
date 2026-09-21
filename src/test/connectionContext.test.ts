import * as assert from "assert";
import * as http from "http";
import https = require("https");
import * as vscode from "vscode";
import { initializeApiKeyStore, setApiKeyForScope } from "../config/apiKeyStore";
import { requestJson, requestText, runWithConnectionScope } from "../redmine/client";
import { withConfiguration } from "./helpers/configuration";
import { MemorySecretStorage } from "./helpers/secretStorage";

suite("Redmine connection context", () => {
  test("接続切替・nested/parallel scope でも接続先固有の認証情報を送る", async () => {
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    await initializeApiKeyStore(secrets, subscriptions);
    const received: Array<[string | undefined, string | string[] | undefined]> = [];
    const server = http.createServer((request, response) => {
      received.push([request.url, request.headers["x-redmine-api-key"]]);
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const a = `http://127.0.0.1:${address.port}/a/`;
    const b = `http://127.0.0.1:${address.port}/b/`;
    try {
      await setApiKeyForScope(a, "key-a");
      await setApiKeyForScope(b, "key-b");
      await runWithConnectionScope(a, async () => {
        await requestJson({ method: "GET", path: "first" });
        await runWithConnectionScope(b, () => requestText({ method: "GET", path: "nested" }));
        await requestJson({ method: "GET", path: "restored" });
      });
      await runWithConnectionScope(b, () => requestJson({ method: "GET", path: "switched" }));
      await Promise.all([
        runWithConnectionScope(a, () => requestText({ method: "GET", path: "parallel" })),
        runWithConnectionScope(b, () => requestJson({ method: "GET", path: "parallel" })),
      ]);
      await runWithConnectionScope(a, () => runWithConnectionScope(`${a}missing/`, () =>
        assert.rejects(requestJson({ method: "GET", path: "missing" }), /Missing Redmine API key/)));
      await withConfiguration("baseUrl", a, () => requestJson({ method: "GET", path: "configured" }));
      await withConfiguration("baseUrl", b, () => requestText({ method: "GET", path: "configured" }));
      assert.deepStrictEqual(received.sort(), [
        ["/a/configured", "key-a"], ["/b/configured", "key-b"],
        ["/a/first", "key-a"], ["/b/nested", "key-b"], ["/a/restored", "key-a"],
        ["/b/switched", "key-b"], ["/a/parallel", "key-a"], ["/b/parallel", "key-b"],
      ].sort());
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      secrets.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  for (const baseUrl of ["http://localhost", "http://127.0.0.1", "http://[::1]", "https://remote.example.com"]) {
    test(`${baseUrl} は transport policy を通過する`, async () => {
      const secrets = new MemorySecretStorage();
      const subscriptions: vscode.Disposable[] = [];
      await initializeApiKeyStore(secrets, subscriptions);
      try {
        await runWithConnectionScope(baseUrl, () =>
          assert.rejects(requestJson({ method: "GET", path: "issues.json" }), /Missing Redmine API key/));
      } finally {
        subscriptions.forEach((subscription) => subscription.dispose());
        secrets.dispose();
      }
    });
  }

  test("HTTPS request は対象 scope の key を transport へ渡す", async () => {
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    await initializeApiKeyStore(secrets, subscriptions);
    const baseUrl = "https://remote.example.com/redmine/";
    await setApiKeyForScope(baseUrl, "test-https-key");
    const originalRequest = https.request;
    const reachedTransport = new Error("transport reached");
    const calls: unknown[][] = [];
    https.request = (...args: unknown[]) => { calls.push(args); throw reachedTransport; };
    try {
      for (const request of [requestJson, requestText]) {
        await runWithConnectionScope(baseUrl, () => assert.rejects(
          request({ method: "GET", path: "issues.json" }), (error) => error === reachedTransport,
        ));
      }
      assert.strictEqual(calls.length, 2);
      for (const [url, options] of calls) {
        assert.ok(url instanceof URL);
        assert.strictEqual(url.href, `${baseUrl}issues.json`);
        assert.ok(options && typeof options === "object" && "headers" in options);
        assert.deepStrictEqual(options.headers, { "X-Redmine-API-Key": "test-https-key" });
      }
    } finally {
      https.request = originalRequest;
      subscriptions.forEach((subscription) => subscription.dispose());
      secrets.dispose();
    }
  });

  test("path が別 origin を指定しても API key を送らない", async () => {
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    await initializeApiKeyStore(secrets, subscriptions);
    await setApiKeyForScope("https://a.example", "test-origin-key");
    try {
      for (const request of [requestJson, requestText]) {
        await runWithConnectionScope("https://a.example", () => assert.rejects(
          request({ method: "GET", path: "https://b.example/issues.json" }),
          { message: vscode.l10n.t("Redmine request URL must belong to the configured connection.") },
        ));
      }
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      secrets.dispose();
    }
  });

  test("非loopback HTTP は認証情報の読み出し・HTTP request より前に拒否する", async () => {
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    await initializeApiKeyStore(secrets, subscriptions);
    await setApiKeyForScope("http://remote.example.com", "private-key");
    secrets.get = async () => { throw new Error("must not read credentials"); };
    try {
      for (const request of [requestJson, requestText]) {
        await runWithConnectionScope("http://remote.example.com", () => assert.rejects(
          request({ method: "GET", path: "issues.json" }),
          { message: vscode.l10n.t("Redmine must use HTTPS because the API key is sent with every request.") },
        ));
      }
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      secrets.dispose();
    }
  });
});

suite("Redmine HTTP response limits", () => {
  const limit = 10 * 1024 * 1024;
  const withServer = async (handler: http.RequestListener, check: () => Promise<void>): Promise<void> => {
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    await initializeApiKeyStore(secrets, subscriptions);
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await setApiKeyForScope(`http://127.0.0.1:${address.port}`, "test-response-key");
    try {
      await runWithConnectionScope(`http://127.0.0.1:${address.port}`, check);
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      secrets.dispose();
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
