const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("architecture gate rejects new violations and exempts framework-core", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-architecture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };
  for (const file of ["scripts/check-architecture.cjs", "architecture.config.json", "tsconfig.json"]) {
    write(file, fs.readFileSync(path.join(__dirname, "..", file)));
  }
  fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"), "junction");
  write("scripts/architecture-baseline.json", "{}");
  write("src/packages/framework-core/index.ts", "// Native timer wrapper\nexport const timer = setTimeout;");
  const webview = "src/layers/webview/features/other/index.ts";
  write(webview, "export const other = 1;");
  write("src/layers/extension-host/features/private/internal/value.ts", "export const value = 1;");
  const feature = "src/layers/extension-host/features/demo/index.ts";
  const demo = [
    'export { Other } from "./internal/other";',
    "export interface DemoOptions { enabled: boolean }",
    "export class Demo {}",
    "export const createDemo = () => new Demo();",
  ].join("\n");
  write("src/layers/extension-host/features/demo/internal/other.ts", "export class Other {}");
  write(feature, demo);
  const check = (...args) => spawnSync(process.execPath, ["scripts/check-architecture.cjs", ...args], { cwd: root, encoding: "utf8" });
  const clean = check();
  assert.equal(clean.status, 0, clean.stderr);
  write(feature, [
    'export { other } from "../../../webview/features/other";',
    'export { value } from "../private/internal/value";',
    '// Explanatory comment',
    '// @ts-ignore',
    'setTimeout(() => undefined, 0);',
  ].join("\n"));
  write(webview, 'export { readFile } from "node:fs";');
  const invalid = check();
  assert.equal(invalid.status, 1, invalid.stderr);
  for (const rule of ["layer-import", "feature-import", "host-api-import", "restricted-api", "comment", "suppression"]) {
    assert.ok(invalid.stderr.includes(`[${rule}]`), `Missing ${rule}: ${invalid.stderr} ${invalid.stdout}`);
  }

  write(webview, "export const other = 1;");
  write(feature, `${demo}\nconst OtherImplementation = class {};`);
  const multipleClasses = check();
  assert.equal(multipleClasses.status, 1, multipleClasses.stderr);
  assert.match(multipleClasses.stderr, /\[multiple-implementation-classes\].*Demo.*OtherImplementation/);
  write(feature, demo);
  const legacy = "src/legacy.ts";
  const baselineFile = "scripts/architecture-baseline.json";
  const baselinePath = path.join(root, baselineFile);
  const digest = value => require("node:crypto").createHash("sha256").update(value).digest("hex").slice(0, 20);
  const existingClasses = "class First {} class Second {}";
  const baseline = JSON.stringify({
    [`${legacy}:restricted-api:${digest("setTimeout")}`]: 1,
    [`${legacy}:multiple-implementation-classes:${digest(JSON.stringify(["First", "Second"]))}`]: 1,
  });
  write(baselineFile, baseline);
  write(legacy, `export const timer = setTimeout; ${existingClasses}`);
  assert.equal(check().status, 0);
  write(legacy, `export const timer = setTimeout; export const another = setTimeout; ${existingClasses} class Third {}`);
  const worsened = check("--record-legacy");
  assert.equal(worsened.status, 1, worsened.stderr);
  assert.match(worsened.stderr, /restricted-api/);
  assert.match(worsened.stderr, /multiple-implementation-classes.*Third/);
  assert.equal(fs.readFileSync(baselinePath, "utf8"), baseline);
  write(legacy, "export const value = 1;");
  assert.equal(check().status, 1);
  assert.equal(check("--record-legacy").status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), {});
});

test("主要機能の入口と検証ファイルが存在する", () => {
  const { features, entryPoints } = require("./feature-map.json");
  const { contributes } = require("../package.json");
  const known = new Set([
    ...contributes.commands.map(item => item.command),
    ...Object.values(contributes.views).flat().map(item => item.id),
  ]);
  assert.deepEqual(entryPoints.map(item => item.id).sort(), [...known].sort());
  assert.ok(features.length > 0);
  assert.equal(new Set(features.map(feature => feature.id)).size, features.length);
  for (const feature of features) {
    assert.ok(feature.entryPoints.length && feature.invariants.length && feature.checks.length, feature.id);
    for (const entry of feature.entryPoints) {
      assert.ok(known.has(entry), entry);
    }
    for (const check of feature.checks) {
      assert.ok(fs.existsSync(path.join(__dirname, "..", check)), check);
    }
  }
});
