const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { contributes } = require("../package.json");
const map = require("./feature-map.json");

async function run() {
  if (process.argv.length !== 3 || process.argv[2] !== "run") {
    throw new Error("Usage: pnpm run verify run");
  }
  const known = new Set([
    ...contributes.commands.map(item => item.command),
    ...Object.values(contributes.views).flat().map(item => item.id),
  ]);
  const mapped = new Set(map.entryPoints.map(item => item.id));
  if (known.size !== mapped.size || mapped.size !== map.entryPoints.length ||
      [...known].some(id => !mapped.has(id)) || !map.scenarios.length ||
      new Set(map.scenarios.map(item => item.id)).size !== map.scenarios.length ||
      map.scenarios.some(item => !mapped.has(item.command) ||
        ![item.maxLatencyMs, item.maxCpuMs, item.maxRssBytes].every(value => Number.isFinite(value) && value > 0))) {
    throw new Error("Update verification/feature-map.json to match package.json and define valid scenarios.");
  }

  const root = path.resolve(__dirname, "..");
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-verification-"));
  const traceFile = path.join(artifacts, "trace.json");
  const profile = path.join(artifacts, "profile");
  const launchArgs = ["--user-data-dir", profile, "--extensions-dir", path.join(artifacts, "extensions"),
    "--disable-extensions", "--disable-workspace-trust", "--skip-welcome"];
  if (process.env.VSCODE_TEST_ELECTRON_ARGS) {
    launchArgs.push(...process.env.VSCODE_TEST_ELECTRON_ARGS.trim().split(/\s+/));
  }
  let error;
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, "out/test/referenceVerification.js"),
      extensionTestsEnv: {
        REDMINE_VERIFICATION_MAP: path.join(__dirname, "feature-map.json"),
        REDMINE_VERIFICATION_REPORT: traceFile,
      },
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      launchArgs,
    });
  } catch (failure) {
    error = String(failure);
  }
  const trace = fs.existsSync(traceFile) ? JSON.parse(fs.readFileSync(traceFile, "utf8")) : [];
  const passed = !error && trace.length === map.scenarios.length &&
    trace.every((item, index) => !item.error && item.id === map.scenarios[index].id);
  const report = { passed, error, artifacts, logs: path.join(profile, "logs"), trace };
  fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exitCode = passed ? 0 : 1;
}

run().catch(error => {
  console.log(JSON.stringify({ passed: false, error: String(error) }));
  process.exitCode = 1;
});
