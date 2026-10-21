import * as assert from "assert";
import { RedmineHttpError, extractHttpStatusCode } from "../redmine/httpError";
import { isRemoteCommitUnknownError } from "../views/ticketSync/ticketSyncResult";

suite("HTTP応答と結果不明の分類", () => {
  test("HTTPステータスを本文のnetwork/timeoutや別の数値より優先する", () => {
    for (const word of ["network policy", "timeout 503", "socket reset"]) {
      assert.strictEqual(isRemoteCommitUnknownError(new RedmineHttpError(403, word)), false);
      assert.strictEqual(isRemoteCommitUnknownError(new Error(`Redmine request failed (403): ${word}`)), false);
    }
    assert.strictEqual(extractHttpStatusCode({ status: 403, message: "HTTP 503" }), 403);
  });
  test("書き込み結果が不明なproxy応答と応答のない通信障害を区別する", () => {
    for (const code of [408, 502, 503, 504]) {
      assert.strictEqual(isRemoteCommitUnknownError(new RedmineHttpError(code, "failure")), true);
    }
    for (const code of [400, 403, 409, 422, 500]) {
      assert.strictEqual(isRemoteCommitUnknownError(new RedmineHttpError(code, "network timeout")), false);
    }
    assert.strictEqual(isRemoteCommitUnknownError(new Error("ECONNRESET")), true);
  });
});
