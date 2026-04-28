import * as assert from "assert";
import type { SyncUnsyncedFileResult } from "../commands/syncUnsyncedFile";

suite("syncUnsyncedFileResult — 型構造", () => {
  test("success の結果が ticket kind を持つ", () => {
    const result: SyncUnsyncedFileResult = { status: "success", kind: "ticket", id: 42 };
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.kind, "ticket");
    assert.strictEqual(result.id, 42);
  });

  test("no_change は成功扱いできる", () => {
    const result: SyncUnsyncedFileResult = { status: "no_change", kind: "ticket", id: 1 };
    assert.strictEqual(result.status, "no_change");
    assert.notStrictEqual(result.status, "failed");
    assert.notStrictEqual(result.status, "conflict");
  });

  test("conflict はエラー扱いしない・成功扱いもしない", () => {
    const result: SyncUnsyncedFileResult = { status: "conflict", kind: "ticket", id: 5 };
    assert.strictEqual(result.status, "conflict");
    assert.notStrictEqual(result.status, "success");
    assert.notStrictEqual(result.status, "failed");
  });

  test("failed は message を持てる", () => {
    const result: SyncUnsyncedFileResult = { status: "failed", kind: "comment", message: "API error" };
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.message, "API error");
  });

  test("newTicket kind が使える", () => {
    const result: SyncUnsyncedFileResult = { status: "success", kind: "newTicket", id: 100 };
    assert.strictEqual(result.kind, "newTicket");
  });

  test("comment kind が使える", () => {
    const result: SyncUnsyncedFileResult = { status: "success", kind: "comment", id: 7 };
    assert.strictEqual(result.kind, "comment");
  });
});

suite("syncUnsyncedFileResult — toast メッセージ形式", () => {
  const formatSyncOneToast = (result: SyncUnsyncedFileResult): { kind: "info" | "warning" | "error"; message: string } => {
    switch (result.status) {
      case "success":
        return { kind: "info", message: "同期しました。" };
      case "no_change":
        return { kind: "info", message: "変更なし。" };
      case "conflict":
        return { kind: "warning", message: "競合が発生しています。ファイルを確認してください。" };
      case "failed":
        return { kind: "error", message: `同期に失敗しました: ${result.message ?? ""}` };
    }
  };

  test("success 時は info toast", () => {
    const t = formatSyncOneToast({ status: "success", kind: "ticket", id: 1 });
    assert.strictEqual(t.kind, "info");
  });

  test("no_change 時は info toast (エラーではない)", () => {
    const t = formatSyncOneToast({ status: "no_change", kind: "ticket", id: 1 });
    assert.strictEqual(t.kind, "info");
  });

  test("conflict 時は warning toast (エラーではない)", () => {
    const t = formatSyncOneToast({ status: "conflict", kind: "ticket", id: 1 });
    assert.strictEqual(t.kind, "warning");
  });

  test("failed 時は error toast", () => {
    const t = formatSyncOneToast({ status: "failed", kind: "ticket", message: "timeout" });
    assert.strictEqual(t.kind, "error");
    assert.ok(t.message.includes("timeout"));
  });
});
