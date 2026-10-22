#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { fork, spawn, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const phaseVariable = "REDMINE_LIVE_PHASE";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("REDMINE_SYNC_LIVE_URL must use HTTP or HTTPS");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function copyFixtureExtension(fixtureDir) {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  manifest.main = "./entry.cjs";
  manifest.activationEvents = ["*"];
  fs.writeFileSync(path.join(fixtureDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const directory of ["l10n", "media"]) {
    const source = path.join(repoRoot, directory);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(fixtureDir, directory), { recursive: true });
    }
  }

  const extensionModule = path.join(repoRoot, "out", "extension.js");
  const hostContextModule = path.join(repoRoot, "out", "test", "live", "hostContext.js");
  const entry = [
    '"use strict";',
    `const extension = require(${JSON.stringify(extensionModule)});`,
    `const hostContext = require(${JSON.stringify(hostContextModule)});`,
    "exports.activate = async (context) => {",
    "  hostContext.setLiveHostContext(context);",
    "  await extension.activate(context);",
    "  hostContext.setLiveHostContext(context);",
    "  if (process.env.REDMINE_LIVE_PERSISTENT_HOST === '1') {",
    `    const Mocha = require(${JSON.stringify(require.resolve("mocha", { paths: [path.dirname(require.resolve("@vscode/test-cli"))] }))});`,
    "    const mocha = new Mocha({ ui: 'tdd', timeout: 120000, color: false });",
    "    for (const file of JSON.parse(process.env.REDMINE_LIVE_FILES)) mocha.addFile(file);",
    "    setImmediate(() => mocha.run((failures) => {",
    "      require('node:fs').writeFileSync(process.env.REDMINE_LIVE_HOST_RESULT, JSON.stringify({ failures }));",
    "      require('vscode').commands.executeCommand('workbench.action.quit');",
    "    }));",
    "  }",
    "};",
    "exports.deactivate = () => extension.deactivate?.();",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(fixtureDir, "entry.cjs"), entry);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function createRedmineProxy(upstream, statePath, markerPath, tracePath) {
  const target = new URL(upstream);
  let phase = "idle";
  const server = http.createServer((incoming, outgoing) => {
    const requestPath = incoming.url || "/";
    const destination = new URL(requestPath.replace(/^\/+/, ""), target);
    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: incoming.method,
      path: destination.pathname + destination.search,
      headers: { ...incoming.headers, host: target.host },
    };
    const forward = (target.protocol === "https:" ? require("node:https") : http).request(options, (response) => {
      const writes = ["POST", "PUT", "PATCH", "DELETE"].includes((incoming.method || "").toUpperCase());
      const state = readStateFile();
      const matches = typeof state.holdPath === "string" && requestPath.includes(state.holdPath);
      appendTrace({ method: incoming.method || "GET", path: requestPath.split("?", 1)[0], statusCode: response.statusCode || 502 });
      if (phase === "prepare" && writes && response.statusCode >= 200 && response.statusCode < 300 && matches && !fs.existsSync(markerPath)) {
        writeJsonAtomic(markerPath, {
          kind: "remote-write-committed",
          method: incoming.method,
          path: requestPath,
          statusCode: response.statusCode,
        });
        // Deliberately withhold the response. The parent terminates the host after
        // observing the marker, leaving the durable operation before local finalize.
        response.resume();
        return;
      }
      outgoing.writeHead(response.statusCode || 502, response.headers);
      response.pipe(outgoing);
    });
    forward.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain" });
      outgoing.end("Redmine proxy request failed");
    });
    incoming.pipe(forward);
  });

  function readStateFile() {
    if (!fs.existsSync(statePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      return {};
    }
  }

  function appendTrace(trace) {
    let traces = [];
    try {
      traces = JSON.parse(fs.readFileSync(tracePath, "utf8"));
      if (!Array.isArray(traces)) traces = [];
    } catch {
      traces = [];
    }
    traces.push(trace);
    writeJsonAtomic(tracePath, traces);
  }

  return {
    server,
    setPhase(value) { phase = value; },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("Proxy did not bind TCP port"));
          resolve(`http://127.0.0.1:${address.port}/`);
        });
      });
    },
    close() { return new Promise((resolve) => server.close(() => resolve())); },
  };
}

function testRunnerPath() {
  const entry = require.resolve("@vscode/test-cli");
  return path.join(path.dirname(entry), "runner.cjs");
}

async function runTestHost({ fixtureDir, userDataDir, extensionsDir, workspaceDir, files, env }) {
  if (env.REDMINE_LIVE_PERSISTENT_HOST === "1") {
    const { downloadAndUnzipVSCode } = require("@vscode/test-electron");
    const executable = await downloadAndUnzipVSCode({ version: "1.138.0" });
    const resultPath = path.join(userDataDir, `host-result-${env.REDMINE_LIVE_PHASE}.json`);
    fs.rmSync(resultPath, { force: true });
    const native = spawn(executable, [workspaceDir, `--extensionDevelopmentPath=${fixtureDir}`,
      `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
      `--shared-data-dir=${path.join(userDataDir, "shared-data")}`, "--password-store=basic",
      "--no-sandbox", "--disable-gpu-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
    ], { stdio: "inherit", env: { ...env, REDMINE_LIVE_HOST_RESULT: resultPath } });
    const stop = (message) => { if (message?.kind === "stop-code") native.kill("SIGTERM"); };
    process.on("message", stop);
    try {
      await new Promise((resolve, reject) => {
        native.once("error", reject);
        native.once("close", resolve);
      });
      if (!fs.existsSync(resultPath)) return 1;
      return JSON.parse(fs.readFileSync(resultPath, "utf8")).failures ? 1 : 0;
    } finally { process.removeListener("message", stop); process.disconnect?.(); }
  }
  const options = {
    mochaOpts: {
      ui: "tdd",
      timeout: 120000,
      require: [],
    },
    colorDefault: false,
    preload: [path.join(repoRoot, "out", "test", "live", "activateHost.js")],
    files,
  };
  const { runTests } = require("@vscode/test-electron");
  return runTests({
    version: "1.138.0",
    extensionDevelopmentPath: fixtureDir,
    extensionTestsPath: testRunnerPath(),
    extensionTestsEnv: {
      ...env,
      VSCODE_TEST_OPTIONS: JSON.stringify(options),
    },
    launchArgs: [
      workspaceDir,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      `--shared-data-dir=${path.join(userDataDir, "shared-data")}`,
      "--password-store=basic",
      ...(process.env.REDMINE_LIVE_DEBUG === "1" ? ["--log=trace"] : []),
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
}

function waitForFile(filePath, child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(timer);
        resolve();
      } else if (child.exitCode !== null || child.signalCode !== null) {
        clearInterval(timer);
        reject(new Error(`VS Code test process exited before checkpoint (code ${child.exitCode ?? child.signalCode})`));
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for live restart checkpoint"));
      }
    }, 100);
  });
}

function killHostTree(child) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    if (result.error) throw result.error;
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function cleanupRestartProject(upstream, statePath) {
  if (!fs.existsSync(statePath)) return;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!Number.isSafeInteger(state.projectId) || state.projectId <= 0) return;
  await new Promise((resolve, reject) => {
    const request = http.request(new URL(`projects/${state.projectId}.json`, upstream), {
      method: "DELETE", headers: { "X-Redmine-API-Key": process.env.REDMINE_API_KEY },
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode === 200 || response.statusCode === 204 || response.statusCode === 404) resolve();
        else reject(new Error(`再起動テスト用projectの削除に失敗: HTTP ${response.statusCode}`));
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error("fixture cleanup timeout")));
    request.once("error", reject);
    request.end();
  });
}

function writeSummary(reportDir, selectedTests, restartResult, suiteFailures) {
  const cases = [];
  const missing = [];
  for (const file of selectedTests) {
    const resultPath = path.join(reportDir, `${path.basename(file)}.json`);
    if (fs.existsSync(resultPath)) cases.push(...JSON.parse(fs.readFileSync(resultPath, "utf8")).cases);
    else missing.push(path.basename(file));
  }
  if (restartResult) cases.push(restartResult);
  writeJsonAtomic(path.join(reportDir, "summary.json"), { upstream: "http://127.0.0.1:3000/", cases, missing, suiteFailures });
  const lines = ["# 実Redmine同期テスト結果", "", "接続先: http://127.0.0.1:3000/", "",
    `成功: ${cases.filter((item) => item.status === "passed").length} / 失敗: ${cases.filter((item) => item.status === "failed").length} / 未実行: ${cases.filter((item) => item.status === "not_run").length} / 未完了suite: ${missing.length} / suiteエラー: ${suiteFailures.length}`, "",
    "| ID | 結果 | 確認内容 |", "| --- | --- | --- |",
    ...cases.map((item) => `| ${item.id} | ${item.status} | ${item.title.replaceAll("|", "\\|")} |`),
    ...missing.map((file) => `| ${file} | 未完了 | 結果ファイルがありません |`), "",
    ...suiteFailures.map((failure) => `- ${failure}`), "",
    "各JSONにケース別の結果と通信記録を保存しています。再起動時の通信は restart-traces.json を参照してください。", ""];
  fs.writeFileSync(path.join(reportDir, "summary.md"), lines.join("\n"));
}

async function runWorker() {
  const workspaceDir = process.env.REDMINE_LIVE_WORKSPACE;
  const env = { ...process.env };
  delete env.REDMINE_LIVE_WORKSPACE;
  const code = await runTestHost({
    fixtureDir: process.env.REDMINE_LIVE_FIXTURE,
    userDataDir: process.env.REDMINE_LIVE_USER_DATA,
    extensionsDir: process.env.REDMINE_LIVE_EXTENSIONS,
    workspaceDir,
    files: JSON.parse(process.env.REDMINE_LIVE_FILES),
    env,
  });
  process.exitCode = code;
}

async function runChildHost({ fixtureDir, userDataDir, extensionsDir, workspaceDir, files, env }) {
  const child = fork(__filename, [], {
    detached: true,
    stdio: "inherit",
    env: {
      ...env,
      REDMINE_LIVE_WORKER: "1",
      REDMINE_LIVE_FIXTURE: fixtureDir,
      REDMINE_LIVE_USER_DATA: userDataDir,
      REDMINE_LIVE_EXTENSIONS: extensionsDir,
      REDMINE_LIVE_WORKSPACE: workspaceDir,
      REDMINE_LIVE_FILES: JSON.stringify(files),
    },
  });
  return { child, completion: new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }) };
}

async function runSuite({ fixtureDir, userDataDir, extensionsDir, workspaceDir, file, env }) {
  const { child, completion } = await runChildHost({
    fixtureDir, userDataDir, extensionsDir, workspaceDir,
    files: [path.isAbsolute(file) ? file : path.join(repoRoot, "out", "test", file)],
    env,
  });
  const result = await completion;
  if (result.code !== 0) throw new Error(`Live suite failed (${result.code ?? result.signal})`);
}

function normalLiveTestFiles() {
  const liveDirectory = path.join(repoRoot, "out", "test", "live");
  const names = new Set(["normalSync.test.js", "recoverySync.test.js", "conflictsSync.test.js", "entrypointsSync.test.js", "isolationSync.test.js", "durabilitySync.test.js", "dashboardSync.test.js"]);
  return fs.readdirSync(liveDirectory)
    .filter((name) => names.has(name))
    .map((name) => path.join(liveDirectory, name));
}

async function run() {
  if (process.env.REDMINE_LIVE_WORKER === "1") return runWorker();

  const upstream = normalizeBaseUrl(requiredEnv("REDMINE_SYNC_LIVE_URL"));
  if (upstream.toString() !== "http://127.0.0.1:3000/") {
    throw new Error("REDMINE_SYNC_LIVE_URL must be http://127.0.0.1:3000/ for this live suite");
  }
  requiredEnv("REDMINE_API_KEY");
  const restartTest = path.join(repoRoot, "out", "test", "live", "restartSync.test.js");
  for (const file of [path.join(repoRoot, "out", "extension.js"), restartTest, path.join(repoRoot, "out", "test", "live")]) {
    if (!fs.existsSync(file)) throw new Error(`Missing compiled live test artifact: ${path.relative(repoRoot, file)}. Compile first.`);
  }
  const normalTests = normalLiveTestFiles();
  const selectedTests = process.env.REDMINE_LIVE_ONLY
    ? normalTests.filter((file) => path.basename(file).includes(process.env.REDMINE_LIVE_ONLY)) : normalTests;
  if (process.env.REDMINE_LIVE_ONLY && !selectedTests.length && process.env.REDMINE_LIVE_ONLY !== "restart") {
    throw new Error("REDMINE_LIVE_ONLY に一致するsuiteがありません。");
  }
  if (normalTests.length === 0) throw new Error("No compiled normal live suites were found. Compile first.");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-live-restart-"));
  const reportDir = process.env.REDMINE_LIVE_REPORT_DIR || path.join(repoRoot, "docs", "reports", `live-redmine-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const fixtureDir = path.join(tempRoot, "extension");
  const userDataDir = path.join(tempRoot, "user-data");
  const extensionsDir = path.join(tempRoot, "extensions");
  const workspaceDir = path.join(tempRoot, "workspace");
  const statePath = path.join(tempRoot, "restart-state.json");
  const markerPath = path.join(tempRoot, "checkpoint.json");
  const tracePath = path.join(tempRoot, "proxy-traces.json");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  writeJsonAtomic(tracePath, []);
  copyFixtureExtension(fixtureDir);

  const proxy = createRedmineProxy(upstream.toString(), statePath, markerPath, tracePath);
  const proxyBaseUrl = await proxy.listen();
  const commonEnv = {
    ...process.env,
    REDMINE_SYNC_LIVE_URL: upstream.toString(),
    REDMINE_API_KEY: process.env.REDMINE_API_KEY,
    REDMINE_LIVE_PROXY_URL: proxyBaseUrl,
    REDMINE_LIVE_STATE_PATH: statePath,
    REDMINE_LIVE_MARKER_PATH: markerPath,
    REDMINE_LIVE_TRACE_PATH: tracePath,
  };
  delete commonEnv[phaseVariable];

  let restartResult = process.env.REDMINE_LIVE_SKIP_RESTART === "1" ? undefined : {
    id: "LIVE-P01", title: "実Extension Host停止後の同一永続領域からの同期復旧", status: "not_run",
  };
  let activeHost;
  const failures = [];
  try {
    for (const file of selectedTests) {
      try {
        await runSuite({ fixtureDir, userDataDir, extensionsDir, workspaceDir, file,
          env: { ...commonEnv, REDMINE_LIVE_REPORT_PATH: path.join(reportDir, `${path.basename(file)}.json`) } });
      } catch (error) { failures.push(`${path.basename(file)}: ${error.message}`); }
    }
    if (failures.length) throw new Error(failures.join("\n"));

    if (process.env.REDMINE_LIVE_SKIP_RESTART === "1") return;

    restartResult = { id: "LIVE-P01", title: "実Extension Host停止後の同一永続領域からの同期復旧", status: "failed" };
    proxy.setPhase("prepare");
    fs.rmSync(markerPath, { force: true });
    const prepare = await runChildHost({
      fixtureDir, userDataDir, extensionsDir, workspaceDir,
      files: [restartTest],
      env: { ...commonEnv, [phaseVariable]: "prepare", REDMINE_LIVE_PERSISTENT_HOST: "1" },
    });
    activeHost = prepare.child;
    await waitForFile(markerPath, prepare.child, 120000);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!Number.isSafeInteger(state.hostPid) || state.hostPid <= 0) throw new Error("Extension Host PIDがありません。");
    process.kill(state.hostPid, "SIGKILL");
    prepare.child.send({ kind: "stop-code" });
    // Extension Hostだけを停止し、VS Code本体に永続状態を保持させる。
    const timer = setTimeout(() => killHostTree(prepare.child), 15000);
    try { await prepare.completion; } finally { clearTimeout(timer); }
    activeHost = undefined;

    proxy.setPhase("resume");
    const resume = await runChildHost({
      fixtureDir, userDataDir, extensionsDir, workspaceDir,
      files: [restartTest],
      env: { ...commonEnv, [phaseVariable]: "resume", REDMINE_LIVE_PERSISTENT_HOST: "1" },
    });
    activeHost = resume.child;
    const result = await resume.completion;
    activeHost = undefined;
    if (result.code !== 0) throw new Error(`Restart recovery suite failed (${result.code ?? result.signal})`);
    restartResult.status = "passed";
    process.stdout.write("Live Redmine restart recovery suite passed.\n");
  } finally {
    if (activeHost) killHostTree(activeHost);
    proxy.server.closeAllConnections();
    await proxy.close();
    if (fs.existsSync(tracePath)) fs.copyFileSync(tracePath, path.join(reportDir, "restart-traces.json"));
    writeSummary(reportDir, selectedTests, restartResult, failures);
    process.stdout.write(`実Redmine検証結果: ${reportDir}\n`);
    try { await cleanupRestartProject(upstream, statePath); }
    finally {
      if (process.env.REDMINE_LIVE_DEBUG === "1") process.stdout.write(`テスト環境診断: ${tempRoot}\n`);
      else fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
