import * as assert from "assert";
import {
  clearOfflineSyncQueue,
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { syncUnsyncedFile, type SyncUnsyncedFileResult } from "../commands/syncUnsyncedFile";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("syncUnsyncedFileResult — 構造化戻り値", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento());
    clearOfflineSyncQueue();
  });

  teardown(() => {
    clearOfflineSyncQueue();
  });

  test("チケット更新がキューにない場合 undefined を返す", async () => {
    const result = await syncUnsyncedFile({ syncKey: { kind: "ticket", ticketId: 999 } });
    assert.strictEqual(result, undefined);
  });

  test("新規チケットがキューにない場合 undefined を返す", async () => {
    const result = await syncUnsyncedFile({
      syncKey: { kind: "newTicket", documentUri: "file:///not-existing.md" },
    });
    assert.strictEqual(result, undefined);
  });

  test("SyncUnsyncedFileResult 型: success は kind を持つ", () => {
    const r: SyncUnsyncedFileResult = { status: "success", kind: "ticket", id: 1 };
    assert.strictEqual(r.status, "success");
    assert.strictEqual(r.kind, "ticket");
    assert.strictEqual(r.id, 1);
  });

  test("SyncUnsyncedFileResult 型: no_change は kind を持つ", () => {
    const r: SyncUnsyncedFileResult = { status: "no_change", kind: "comment" };
    assert.strictEqual(r.status, "no_change");
    assert.strictEqual(r.kind, "comment");
  });

  test("SyncUnsyncedFileResult 型: conflict は kind を持つ", () => {
    const r: SyncUnsyncedFileResult = { status: "conflict", kind: "ticket", id: 42 };
    assert.strictEqual(r.status, "conflict");
    assert.strictEqual(r.kind, "ticket");
  });

  test("SyncUnsyncedFileResult 型: failed は message を持てる", () => {
    const r: SyncUnsyncedFileResult = {
      status: "failed",
      kind: "newTicket",
      message: "APIエラー",
    };
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.kind, "newTicket");
    assert.strictEqual(r.message, "APIエラー");
  });

  test("SyncUnsyncedFileResult の kind は ticket / newTicket / comment のみ", () => {
    const kinds: SyncUnsyncedFileResult["kind"][] = ["ticket", "newTicket", "comment"];
    for (const kind of kinds) {
      const r: SyncUnsyncedFileResult = { status: "success", kind };
      assert.ok(["ticket", "newTicket", "comment"].includes(r.kind));
    }
  });

  test("コメント更新がキューにない場合 undefined を返す", async () => {
    const result = await syncUnsyncedFile({
      syncKey: { kind: "comment", ticketId: 1, commentId: 999 },
    });
    assert.strictEqual(result, undefined);
  });

  test("キューにあるチケット更新に対して結果オブジェクトが返る", async () => {
    const metadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(1, {
      ticketId: 1,
      baseSubject: "Base",
      baseDescription: "Base",
      baseMetadata: metadata,
      subject: "Updated",
      description: "Updated body",
      metadata,
    });
    // applyQueuedTicketUpdate は HTTP を呼ぶため失敗するが、
    // 結果オブジェクト (failed) が返ることを確認する
    const result = await syncUnsyncedFile({ syncKey: { kind: "ticket", ticketId: 1 } });
    assert.ok(result !== undefined, "undefined でなく結果を返すこと");
    assert.ok(["success", "no_change", "conflict", "failed"].includes(result!.status));
    assert.strictEqual(result!.kind, "ticket");
  });
});
