import * as assert from "assert";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { createSyncEngine } from "../../app/syncEngine";
import { setApiKeyForScope, clearApiKeyForScope } from "../../config/apiKeyStore";
import { runWithConnectionScope, requestJson } from "../../redmine/client";
import { extractHttpStatusCode } from "../../redmine/httpError";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { createFaultProxy } from "./faultProxy";
import { liveTest } from "./liveFixture";

liveTest("LIVE-I01", "別の論理接続先へAPI keyを継承しない", async (live) => {
  const proxy = await createFaultProxy("http://127.0.0.1:3000/");
  try {
    await assert.rejects(runWithConnectionScope(proxy.origin, () => requestJson({ method: "GET", path: "/users/current.json" })), /API key/);
    assert.strictEqual(proxy.hits().length, 0);
    assert.ok(await live.request({ method: "GET", path: "/users/current.json" }));
  } finally { await proxy.close(); }
});

liveTest("LIVE-I02", "不正なAPI keyに対する実HTTP 401では書き込みを開始しない", async (live) => {
  const key = await live.queueNewTicket({ subject: "LIVE-I02 invalid key" });
  const savedKey = process.env.REDMINE_API_KEY;
  assert.ok(savedKey);
  await setApiKeyForScope(live.scope, "invalid-live-test-api-key");
  try {
    const outcome = await live.engine().syncOne(key, live.context);
    assert.notStrictEqual(outcome.kind, "completed");
    assert.ok(live.proxy.hits().some((hit) => hit.status === 401));
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.forwarded && hit.method === "POST" && hit.path === "/issues.json").length, 0);
  } finally { await setApiKeyForScope(live.scope, savedKey); }
});

liveTest("LIVE-I03", "別接続先の同じticket IDのキューとOperationを分離する", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-I03 first scope" });
  const first = live.engine().getRepository().getOperation(key, live.scope);
  assert.ok(first);
  const proxy = await createFaultProxy("http://127.0.0.1:3000/");
  const apiKey = process.env.REDMINE_API_KEY;
  assert.ok(apiKey);
  await setApiKeyForScope(proxy.origin, apiKey);
  try {
    const engine = createSyncEngine();
    assert.strictEqual(engine.getRepository().getOperation(key, proxy.origin), undefined);
    await engine.getRepository().saveOperation({ ...first, operationId: `${first.operationId}-other`, connectionScope: proxy.origin }, proxy.origin);
    assert.strictEqual((await engine.syncOne(key, { connectionScope: proxy.origin })).kind, "completed");
    assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.get(id)?.operationId, first.operationId);
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
    assert.strictEqual(proxy.hits().filter((hit) => hit.method === "PUT").length, 1);
    assert.strictEqual((await live.readIssue(id)).ticket.subject, "LIVE-I03 first scope");
  } finally { await clearApiKeyForScope(proxy.origin); await proxy.close(); }
});

liveTest("LIVE-I04", "別接続先を指定した復旧callbackは元Operationを変更しない", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueComment(id, "LIVE-I04 comment");
  live.proxy.arm({ method: "PUT", path: `/issues/${id}.json`, mode: "drop_after" });
  const engine = live.engine();
  assert.strictEqual((await engine.syncOne(key, live.context)).kind, "commit_unknown");
  const before = engine.getRepository().getOperation(key, live.scope);
  assert.ok(before);
  const beforeQueue = getOfflineSyncQueue(live.scope);
  const outcome = await engine.resolveCommentCommitUnknown({ key,
    context: { connectionScope: "http://127.0.0.1:1/" },
    operationId: before.operationId, operationRevision: before.revision, attemptGeneration: before.attemptGeneration,
    resolution: { kind: "reconcile_remote" },
  });
  assert.notStrictEqual(outcome.kind, "completed");
  assert.deepStrictEqual(getOfflineSyncQueue(live.scope), beforeQueue);
  assert.strictEqual((await live.readIssue(id)).comments.filter((comment) => comment.body === "LIVE-I04 comment").length, 1);
});

const keyForUser = (login: string, password: string): Promise<string> => new Promise((resolve, reject) => {
  const request = http.get("http://127.0.0.1:3000/users/current.json", {
    headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      try {
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof data === "object" && data && "user" in data && typeof data.user === "object" && data.user &&
          "api_key" in data.user && typeof data.user.api_key === "string") {
          assert.ok("login" in data.user && data.user.login === login, "テスト用user自身の認証であること");
          resolve(data.user.api_key);
        } else { reject(new Error("テスト用userのAPI keyを取得できません。")); }
      } catch { reject(new Error("テスト用userの認証応答が不正です。")); }
    });
  });
  request.on("error", reject);
});

liveTest("LIVE-I05", "他人のコメントを更新できないユーザーで実HTTP 403を保持する", async (live) => {
  const login = `live-${randomUUID().slice(0, 10)}`;
  const password = randomUUID();
  const user = await live.request<{ user: { id: number } }>({ method: "POST", path: "/users.json", body: {
    user: { login, password, firstname: "Live", lastname: "Sync", mail: `${login}@example.invalid`,
      must_change_passwd: false, mail_notification: "none" },
  } });
  const proxy = await createFaultProxy("http://127.0.0.1:3000/");
  try {
    await live.request({ method: "PUT", path: `/projects/${live.projectId}.json`, body: { project: { is_public: true } } });
    const id = await live.createIssue();
    await live.request({ method: "PUT", path: `/issues/${id}.json`, body: { issue: { notes: "LIVE-I05 admin comment" } } });
    const comment = (await live.readIssue(id)).comments.find((item) => item.body === "LIVE-I05 admin comment");
    assert.ok(comment);
    const key = await live.queueComment(id, "LIVE-I05 forbidden update", { commentId: comment.id, baseBody: comment.body });
    const operation = live.engine().getRepository().getOperation(key, live.scope);
    assert.ok(operation);
    await setApiKeyForScope(proxy.origin, await keyForUser(login, password));
    const engine = live.engine();
    await engine.getRepository().saveOperation({ ...operation, connectionScope: proxy.origin }, proxy.origin);
    const outcome = await engine.syncOne(key, { connectionScope: proxy.origin });
    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.ok(proxy.hits().some((hit) => hit.method === "PUT" && hit.status === 403));
    assert.strictEqual((await live.readIssue(id)).comments.find((item) => item.id === comment.id)?.body, comment.body);
  } finally {
    await clearApiKeyForScope(proxy.origin);
    await proxy.close();
    await live.request({ method: "DELETE", path: `/users/${user.user.id}.json` });
    await live.request({ method: "PUT", path: `/projects/${live.projectId}.json`, body: { project: { is_public: false } } });
  }
});

liveTest("LIVE-I06", "削除されたticketの実404は成功や自動再作成にしない", async (live) => {
  const id = await live.createIssue();
  const key = await live.queueTicket(id, { subject: "LIVE-I06 deleted" });
  await live.request({ method: "DELETE", path: `/issues/${id}.json` });
  assert.notStrictEqual((await live.engine().syncOne(key, live.context)).kind, "completed");
  await assert.rejects(live.readIssue(id), (error: unknown) => extractHttpStatusCode(error) === 404);
});

liveTest("LIVE-I07", "Effect復旧は選択中の接続先に依存せず元のscopeで送信する", async (live) => {
  const file = path.join(live.directory, "scope-recovery.txt");
  fs.writeFileSync(file, "scope specific upload");
  const key = await live.queueNewTicket({ attachments: [{ kind: "file", filePath: file }] });
  const operation = live.engine().getRepository().getOperation(key, live.scope);
  assert.ok(operation);
  const proxy = await createFaultProxy("http://127.0.0.1:3000/");
  const apiKey = process.env.REDMINE_API_KEY;
  assert.ok(apiKey);
  await setApiKeyForScope(proxy.origin, apiKey);
  try {
    const engine = live.engine();
    await engine.getRepository().saveOperation({ ...operation, connectionScope: proxy.origin }, proxy.origin);
    proxy.arm({ method: "POST", path: "/uploads.json", mode: "status_before", status: 500 });
    await engine.syncOne(key, { connectionScope: proxy.origin });
    const failed = engine.getRepository().getOperation(key, proxy.origin);
    const effect = failed?.effects?.find((item) => item.kind === "attachment_upload");
    assert.ok(failed && effect);
    await engine.resolveEffect({ key, operationId: failed.operationId, operationRevision: failed.revision,
      attemptGeneration: failed.attemptGeneration, context: { connectionScope: proxy.origin },
      effectId: effect.effectId, expectedEffectState: effect.state, resolution: { kind: "retry_effect" },
    });
    assert.strictEqual(proxy.hits().filter((hit) => hit.method === "POST" && hit.path === "/uploads.json").length, 2);
    assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "POST").length, 0);
    const finished = await engine.syncOne(key, { connectionScope: proxy.origin });
    assert.strictEqual(finished.kind, "completed");
  } finally { await clearApiKeyForScope(proxy.origin); await proxy.close(); }
});
