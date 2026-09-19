import * as assert from "assert";
import {
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
  addOfflineTicketUpdateAsync,
} from "../views/offlineSyncStore";
import { syncUnsyncedFile, type SyncUnsyncedFileResult } from "../commands/syncUnsyncedFile";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createSyncEngine, type SyncEngineOutcome } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { ConflictContext } from "../views/ticketSaveTypes";
import type { CommentConflictContext } from "../views/commentSaveTypes";

suite("syncUnsyncedFileResult — 構造化戻り値", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento());
    await clearOfflineSyncQueueAsync();
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync();
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

  test("SyncUnsyncedFileResult 型: success は kind を持つ", async () => {
    const r: SyncUnsyncedFileResult = { status: "success", kind: "ticket", id: 1 };
    assert.strictEqual(r.status, "success");
    assert.strictEqual(r.kind, "ticket");
    assert.strictEqual(r.id, 1);
  });

  test("SyncUnsyncedFileResult 型: no_change は kind を持つ", async () => {
    const r: SyncUnsyncedFileResult = { status: "no_change", kind: "comment" };
    assert.strictEqual(r.status, "no_change");
    assert.strictEqual(r.kind, "comment");
  });

  test("SyncUnsyncedFileResult 型: conflict は kind を持つ", async () => {
    const r: SyncUnsyncedFileResult = { status: "conflict", kind: "ticket", id: 42 };
    assert.strictEqual(r.status, "conflict");
    assert.strictEqual(r.kind, "ticket");
  });

  test("SyncUnsyncedFileResult 型: failed は message を持てる", async () => {
    const r: SyncUnsyncedFileResult = {
      status: "failed",
      kind: "newTicket",
      message: "APIエラー",
    };
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.kind, "newTicket");
    assert.strictEqual(r.message, "APIエラー");
  });

  test("ticket conflict の context と scope を保持し、再同期しない", async () => {
    const connectionScope = getCurrentConnectionScope();
    const conflictContext: ConflictContext = {
      connectionScope,
      ticketId: 42,
      baseSubject: "Base",
      baseDescription: "Base body",
      localSubject: "Local",
      localDescription: "Local body",
      remoteSubject: "Remote",
      remoteDescription: "Remote body",
      remoteMetadata: buildIssueMetadataFixture(),
      remoteUpdatedAt: "2026-09-19T10:00:00Z",
    };
    const engine = createSyncEngine();
    let syncOneCalls = 0;
    engine.syncOne = async (key, context) => {
      syncOneCalls++;
      assert.deepStrictEqual(key, { kind: "ticket", ticketId: 42 });
      assert.deepStrictEqual(context, { connectionScope });
      return { kind: "conflict", ticketId: 42, conflictContext };
    };
    engine.getRecoveryItems = () => [];

    const result = await syncUnsyncedFile(
      { syncKey: { kind: "ticket", ticketId: 42 } },
      { createSyncEngine: () => engine },
    );

    assert.ok(result?.status === "conflict" && result.kind === "ticket");
    assert.strictEqual(result.id, 42);
    assert.strictEqual(result.conflictContext, conflictContext);
    assert.strictEqual(result.conflictContext.connectionScope, connectionScope);
    assert.strictEqual(syncOneCalls, 1);
  });

  test("comment conflict の context と baseBodyKnown を保持し、再同期しない", async () => {
    const connectionScope = getCurrentConnectionScope();
    const commentConflictContext: CommentConflictContext = {
      connectionScope,
      ticketId: 42,
      commentId: 123,
      baseBody: "",
      baseBodyKnown: false,
      localBody: "Local comment",
      remoteBody: "Remote comment",
      remoteUpdatedAt: "2026-09-19T10:00:00Z",
    };
    const engine = createSyncEngine();
    let syncOneCalls = 0;
    engine.syncOne = async (key, context) => {
      syncOneCalls++;
      assert.deepStrictEqual(key, { kind: "comment", ticketId: 42, documentUri: "file:///comment.md" });
      assert.deepStrictEqual(context, { connectionScope });
      return { kind: "conflict", ticketId: 42, commentId: 123, message: "Conflict", commentConflictContext };
    };

    const result = await syncUnsyncedFile(
      { syncKey: { kind: "comment", ticketId: 42, documentUri: "file:///comment.md" } },
      { createSyncEngine: () => engine },
    );

    assert.ok(result?.status === "conflict" && result.kind === "comment");
    assert.strictEqual(result.id, 123);
    assert.strictEqual(result.commentConflictContext, commentConflictContext);
    assert.strictEqual(result.commentConflictContext.connectionScope, connectionScope);
    assert.strictEqual(result.commentConflictContext.baseBodyKnown, false);
    assert.strictEqual(syncOneCalls, 1);
  });

  for (const kind of ["ticket", "comment"] as const) {
    test(`${kind} conflict に context がない場合も conflict として返す`, async () => {
      const engine = createSyncEngine();
      engine.syncOne = async (): Promise<SyncEngineOutcome> => ({ kind: "conflict", ticketId: 42 });
      engine.getRecoveryItems = () => [];

      const result = await syncUnsyncedFile(
        { syncKey: { kind, ticketId: 42, commentId: 123 } },
        { createSyncEngine: () => engine },
      );

      assert.ok(result?.status === "conflict");
      assert.strictEqual(result.kind, kind);
      if (result.kind === "ticket") {
        assert.strictEqual(result.id, 42);
        assert.strictEqual(result.conflictContext, undefined);
      } else {
        assert.strictEqual(result.id, 123);
        assert.strictEqual(result.commentConflictContext, undefined);
      }
    });
  }

  test("SyncUnsyncedFileResult の kind は ticket / newTicket / comment のみ", async () => {
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
    await addOfflineTicketUpdateAsync(1, {
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

  test("queued outcome は failed/Unknown error に変換せず、再同期を自動開始しない", async () => {
    let syncOneCalls = 0;
    const fakeEngine = {
      syncOne: async () => {
        syncOneCalls++;
        return { kind: "queued" as const };
      },
      getRecoveryItems: () => [],
      ticketService: () => ({}),
    } as unknown as ReturnType<typeof import("../app/syncEngine").createSyncEngine>;

    const result = await syncUnsyncedFile(
      { syncKey: { kind: "ticket", ticketId: 123 } },
      {
        createTicketSyncService: (() => ({})) as never,
        createSyncEngine: (() => fakeEngine) as never,
      },
    );

    assert.deepStrictEqual(result, { status: "queued", kind: "ticket", id: 123 });
    assert.strictEqual(syncOneCalls, 1);
  });
});
