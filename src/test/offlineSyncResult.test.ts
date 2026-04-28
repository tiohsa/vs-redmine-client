import * as assert from "assert";
import type { OfflineSyncRunResult } from "../commands/offlineSync";

// OfflineSyncRunResult の型構造テスト
suite("offlineSyncResult — 型構造", () => {
  test("nothing_to_sync の結果構造が正しい", () => {
    const result: OfflineSyncRunResult = {
      status: "nothing_to_sync",
      total: 0,
      synced: 0,
      failed: 0,
      conflicts: 0,
    };
    assert.strictEqual(result.status, "nothing_to_sync");
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.conflicts, 0);
  });

  test("success の結果構造が正しい", () => {
    const result: OfflineSyncRunResult = {
      status: "success",
      total: 5,
      synced: 5,
      failed: 0,
      conflicts: 0,
    };
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.synced, 5);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.conflicts, 0);
  });

  test("partial_failure の結果構造が正しい", () => {
    const result: OfflineSyncRunResult = {
      status: "partial_failure",
      total: 3,
      synced: 2,
      failed: 1,
      conflicts: 1,
    };
    assert.strictEqual(result.status, "partial_failure");
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.synced, 2);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.conflicts, 1);
  });

  test("partial_failure 時に synced + failed = total になる", () => {
    const result: OfflineSyncRunResult = {
      status: "partial_failure",
      total: 3,
      synced: 2,
      failed: 1,
      conflicts: 0,
    };
    assert.strictEqual(result.synced + result.failed, result.total);
  });

  test("cancelled の結果構造が正しい", () => {
    const result: OfflineSyncRunResult = {
      status: "cancelled",
      total: 4,
      synced: 1,
      failed: 3,
      conflicts: 0,
    };
    assert.strictEqual(result.status, "cancelled");
  });

  test("failed の結果構造が正しい", () => {
    const result: OfflineSyncRunResult = {
      status: "failed",
      total: 2,
      synced: 0,
      failed: 2,
      conflicts: 0,
    };
    assert.strictEqual(result.status, "failed");
  });
});

// ダッシュボード toast メッセージのフォーマット検証
suite("offlineSyncResult — toast メッセージ形式", () => {
  const formatSyncToast = (result: OfflineSyncRunResult): string => {
    switch (result.status) {
      case "nothing_to_sync":
        return "同期するものはありません。";
      case "success":
        return `全件同期が完了しました。同期: ${result.synced}件`;
      case "partial_failure":
        return `一部の同期に失敗しました。成功: ${result.synced}件 / 失敗: ${result.failed}件 / 競合: ${result.conflicts}件`;
      case "cancelled":
        return `同期をキャンセルしました。成功: ${result.synced}件 / 未完了: ${result.failed}件`;
      case "failed":
        return "同期に失敗しました。VS Code の通知をご確認ください。";
    }
  };

  test("nothing_to_sync 時は同期するものなしのメッセージ", () => {
    const msg = formatSyncToast({ status: "nothing_to_sync", total: 0, synced: 0, failed: 0, conflicts: 0 });
    assert.strictEqual(msg, "同期するものはありません。");
  });

  test("success 時は全件同期完了のメッセージ", () => {
    const msg = formatSyncToast({ status: "success", total: 3, synced: 3, failed: 0, conflicts: 0 });
    assert.ok(msg.includes("全件同期が完了しました"), "成功メッセージに「全件同期が完了しました」を含む");
    assert.ok(msg.includes("3件"), "件数が含まれる");
  });

  test("partial_failure 時は「全件同期が完了しました」とは表示されない", () => {
    const msg = formatSyncToast({ status: "partial_failure", total: 3, synced: 2, failed: 1, conflicts: 0 });
    assert.ok(!msg.includes("全件同期が完了しました"), "partial_failure でも成功メッセージを出してはいけない");
    assert.ok(msg.includes("一部の同期に失敗しました"), "失敗メッセージを含む");
  });

  test("partial_failure 時に競合件数が含まれる", () => {
    const msg = formatSyncToast({ status: "partial_failure", total: 3, synced: 1, failed: 2, conflicts: 2 });
    assert.ok(msg.includes("競合: 2件"), "競合件数が含まれる");
  });
});
