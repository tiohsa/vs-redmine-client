const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ESLint } = require("eslint");

const eslint = new ESLint();
const inspect = async (source, filePath = "src/test/quality-fixture.test.ts") =>
  (await eslint.lintText(source, { filePath }))[0].messages;

test("空、早期終了、定数・同一値の検証を拒否する", async () => {
  for (const body of [
    "() => {}",
    "() => { return; }",
    "async () => Promise.resolve()",
    "() => { console.log('done'); }",
    "() => { const result = true; return result; }",
    "() => assert.ok(!false)",
    "() => assert.ok(() => verifyResult())",
    "() => assert.strictEqual(1 + 1, 2)",
    "() => { const result = true; assert.ok(result); }",
    "() => { const result = readResult(); assert.strictEqual(result, result); }",
    "() => assert.doesNotReject(async () => Promise.resolve())",
  ]) {
    const diagnostics = await inspect(`test("fixture", ${body});`);
    assert.ok(diagnostics.some(item => item.ruleId === "test-quality/meaningful-test"), body);
  }
  const unreachable = await inspect('test("fixture", () => { return; assert.ok(actual); });');
  assert.ok(unreachable.some(item => item.ruleId === "no-unreachable"));
  const pending = await inspect('test("fixture");');
  assert.ok(pending.some(item => item.ruleId === "test-quality/meaningful-test"));
});

test("Mocha、Node.js、liveTest のスキップと絞り込みを拒否する", async () => {
  for (const [file, source] of [
    ["src/test/quality-fixture.test.ts", 'liveTest.skip("ID", "fixture", () => verifyResult());'],
    ["src/test/helpers/fixture.ts", 'test("fixture", function () { this.skip(); });'],
    ["src/test/quality-fixture.test.ts", 'it["only"]("fixture", () => verifyResult());'],
    ["src/test/quality-fixture.test.ts", 'test("fixture", function () { this.skip(); });'],
    ["verification/quality-fixture.test.cjs", 'test.todo("fixture");'],
    ["verification/quality-fixture.test.cjs", 'test("fixture", { skip: "offline" }, () => verifyResult());'],
    ["verification/quality-fixture.test.cjs", 'test("fixture", context => { context.skip(); });'],
    ["verification/quality-fixture.test.cjs", 'test("parent", parent => parent.test("child", child => child.skip()));'],
  ]) {
    const diagnostics = await inspect(source, file);
    assert.ok(diagnostics.some(item => item.ruleId === "test-quality/meaningful-test"), source);
  }
});

test("観測結果、例外とヘルパーによる検証を許可する", async () => {
  const cases = [
    'test("fixture", () => assert.strictEqual(readResult(), 2));',
    'test("fixture", () => { const same = 2; assert.strictEqual(readResult(), same); });',
    'test("fixture", verifyResult);',
    'test("fixture", async () => { await verifyResult(); });',
    'test("fixture", () => assert.throws(() => readInvalidValue()));',
    'liveTest("ID", "fixture", async fixture => verifyResult(fixture));',
  ];
  for (const source of cases) {
    assert.deepEqual(await inspect(source), [], source);
  }
  assert.deepEqual(await inspect('test("fixture", { skip: false }, () => verifyResult());',
    "verification/quality-fixture.test.cjs"), []);
});
