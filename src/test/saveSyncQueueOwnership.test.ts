import * as assert from "assert";
import { execFile } from "child_process";
import { promisify } from "util";

const runQueue = async (scenario: string): Promise<{
  errors: string[];
  unhandled: string[];
  order: string[];
}> => {
  const script = `
    const maps = [], NativeMap = Map;
    global.Map = class extends NativeMap {
      constructor(...args) { super(...args); maps.push(this); }
    };
    const { enqueueSave, scheduleSave } = require(${JSON.stringify(require.resolve("../app/saveSyncQueue"))});
    global.Map = NativeMap;
    const errors = [], unhandled = [], order = [];
    process.on("unhandledRejection", error => unhandled.push(error.message));
    const observe = async error => { errors.push(error.message); };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    (async () => {
      ${scenario}
      await pause(250);
      require("assert").ok(maps.length === 2 && maps.every(map => map.size === 0), "queue and debounce entries must be cleaned up");
      process.stdout.write(JSON.stringify({ errors, unhandled, order }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return JSON.parse(stdout);
};

suite("Save queue terminal exception ownership", () => {
  test("SQ-01: rejected save is observed once and the URI can be reused", async () => {
    const result = await runQueue(`
      enqueueSave("uri", async () => { throw new Error("failed save"); }, observe);
      await pause(25);
      enqueueSave("uri", async () => { order.push("reused"); }, observe);
    `);
    assert.deepStrictEqual(result, { errors: ["failed save"], unhandled: [], order: ["reused"] });
  });

  test("SQ-02: failure preserves serialized execution of the next save", async () => {
    const result = await runQueue(`
      enqueueSave("uri", async () => {
        order.push("first started");
        await pause(25);
        order.push("first failed");
        throw new Error("failed save");
      }, observe);
      enqueueSave("uri", async () => { order.push("second succeeded"); }, observe);
    `);
    assert.deepStrictEqual(result, {
      errors: ["failed save"], unhandled: [],
      order: ["first started", "first failed", "second succeeded"],
    });
  });

  test("SQ-03: debounce executes only the latest save", async () => {
    const result = await runQueue(`
      scheduleSave("uri", async () => { order.push("superseded"); }, observe);
      await pause(25);
      scheduleSave("uri", async () => { order.push("latest"); }, observe);
    `);
    assert.deepStrictEqual(result, { errors: [], unhandled: [], order: ["latest"] });
  });

  test("observer rejection is owned and does not block the next save", async () => {
    const result = await runQueue(`
      enqueueSave("uri", async () => { throw new Error("failed save"); }, async error => {
        errors.push(error.message);
        throw new Error("failed observer");
      });
      enqueueSave("uri", async () => { order.push("second succeeded"); }, observe);
    `);
    assert.deepStrictEqual(result, { errors: ["failed save"], unhandled: [], order: ["second succeeded"] });
  });
  test("an unresolved notification does not delay the next save or entry cleanup", async () => {
    const result = await runQueue(`
      enqueueSave("uri", async () => { throw new Error("failed save"); }, error => {
        errors.push(error.message);
        return new Promise(() => {});
      });
      enqueueSave("uri", async () => { order.push("second succeeded"); }, observe);
    `);
    assert.deepStrictEqual(result, { errors: ["failed save"], unhandled: [], order: ["second succeeded"] });
  });

  test("scheduled save rejection reaches the observer and cleans up entries", async () => {
    const result = await runQueue(`
      scheduleSave("uri", async () => { throw new Error("scheduled save failed"); }, observe);
    `);
    assert.deepStrictEqual(result, { errors: ["scheduled save failed"], unhandled: [], order: [] });
  });
});
