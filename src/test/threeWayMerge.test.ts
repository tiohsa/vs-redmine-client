import * as assert from "assert";
import { containsConflictMarkers, mergeThreeWay } from "../utils/threeWayMerge";

suite("threeWayMerge", () => {
  test("片側だけの変更を採用する", () => {
    const result = mergeThreeWay("one\ntwo", "one\nlocal", "one\ntwo");

    assert.deepStrictEqual(result, { content: "one\nlocal", hasConflicts: false });
  });

  test("別々の行の変更を自動で統合する", () => {
    const result = mergeThreeWay(
      "one\ntwo\nthree",
      "local one\ntwo\nthree",
      "one\ntwo\nremote three",
    );

    assert.deepStrictEqual(result, {
      content: "local one\ntwo\nremote three",
      hasConflicts: false,
    });
  });

  test("同じ行の変更は競合マーカーとして残す", () => {
    const result = mergeThreeWay("one\ntwo", "one\nlocal", "one\nremote");

    assert.strictEqual(result.hasConflicts, true);
    assert.ok(result.content.includes("<<<<<<< LOCAL\nlocal\n=======\nremote\n>>>>>>> REMOTE"));
    assert.strictEqual(containsConflictMarkers(result.content), true);
  });

  test("両側が同じ変更をした場合は競合にしない", () => {
    const result = mergeThreeWay("one", "changed", "changed");

    assert.deepStrictEqual(result, { content: "changed", hasConflicts: false });
  });
});
