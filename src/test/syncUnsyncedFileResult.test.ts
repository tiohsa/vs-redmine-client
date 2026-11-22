import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
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
    // SyncEngine は HTTP を呼ぶため失敗するが、
    // 結果オブジェクト (failed) が返ることを確認する
    const result = await syncUnsyncedFile({ syncKey: { kind: "ticket", ticketId: 1 } });
    assert.ok(result !== undefined, "undefined でなく結果を返すこと");
    assert.ok(["success", "no_change", "conflict", "failed", "commit_unknown", "recovery_pending", "cancelled"].includes(result!.status));
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

  test("local_finalize_pending の ticket は詳細理由付きメッセージとモーダル復旧で完了またはキャンセルできる", async () => {
    const metadata = buildIssueMetadataFixture();
    const scope = getCurrentConnectionScope();
    await addOfflineTicketUpdateAsync(555, {
      ticketId: 555,
      operationId: "ticket:555",
      baseSubject: "Base",
      baseDescription: "Base",
      baseMetadata: metadata,
      subject: "Updated",
      description: "Updated body",
      metadata,
      phase: "local_finalize_pending",
    }, scope);

    let resolveCalls = 0;
    const fakeEngine = {
      syncOne: async () => ({
        kind: "remote_committed" as const,
        ticketId: 555,
        pending: "local_finalize" as const,
        message: "Editor rewrite pending: stale_source",
      }),
      getRecoveryItems: () => [],
      ticketService: () => ({}),
      resolveLocalFinalize: async () => {
        resolveCalls++;
        return { kind: "completed" as const, ticketId: 555 };
      },
    } as unknown as ReturnType<typeof import("../app/syncEngine").createSyncEngine>;

    const vscode = await import("vscode");
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        (async () => undefined) as unknown as typeof originalShowWarningMessage;
      const cancelled = await syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 555 } },
        {
          suppressResultNotifications: true,
          createTicketSyncService: (() => ({})) as never,
          createSyncEngine: (() => fakeEngine) as never,
        },
      );
      assert.deepStrictEqual(cancelled, { status: "cancelled", kind: "ticket" });
      assert.strictEqual(resolveCalls, 0);

      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        (async (_message: string, _options: unknown, ...items: string[]) => items[0]) as unknown as typeof originalShowWarningMessage;
      const completed = await syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 555 } },
        {
          suppressResultNotifications: true,
          createTicketSyncService: (() => ({})) as never,
          createSyncEngine: (() => fakeEngine) as never,
        },
      );
      assert.deepStrictEqual(completed, { status: "success", kind: "ticket", id: 555, hasRemainingChanges: true });
      assert.strictEqual(resolveCalls, 1);

      const noResolverEngine = {
        ...fakeEngine,
        resolveLocalFinalize: undefined,
      } as unknown as ReturnType<typeof import("../app/syncEngine").createSyncEngine>;
      const pending = await syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 555 } },
        {
          suppressResultNotifications: true,
          createTicketSyncService: (() => ({})) as never,
          createSyncEngine: (() => noResolverEngine) as never,
        },
      );
      assert.strictEqual(pending?.status, "recovery_pending");
      if (pending?.status === "recovery_pending") {
        assert.ok(pending.message.includes("Editor rewrite pending: stale_source"));
      }
    } finally {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        originalShowWarningMessage;
    }
  });

  test("local_finalize_pending で閉じられたファイルが存在する場合は開いて syncOne を再試行する", async () => {
    const metadata = buildIssueMetadataFixture();
    const scope = getCurrentConnectionScope();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-reopen-"));
    const tmpFile = path.join(tmpDir, "ticket-556.md");
    fs.writeFileSync(tmpFile, "# Ticket 556\n", "utf8");
    const documentUri = vscode.Uri.file(tmpFile).toString();

    await addOfflineTicketUpdateAsync(556, {
      ticketId: 556,
      operationId: "ticket:556",
      baseSubject: "Base",
      baseDescription: "Base",
      baseMetadata: metadata,
      subject: "Updated",
      description: "Updated body",
      metadata,
      documentUri,
      phase: "local_finalize_pending",
    }, scope);

    let syncOneCalls = 0;
    let openedBeforeRetry = false;
    const fakeEngine = {
      syncOne: async () => {
        syncOneCalls++;
        if (syncOneCalls === 1) {
          return {
            kind: "remote_committed" as const,
            ticketId: 556,
            pending: "local_finalize" as const,
            message: "Document is closed or not available",
          };
        }
        openedBeforeRetry = vscode.workspace.textDocuments.some(
          (doc) => doc.uri.toString() === documentUri,
        );
        return { kind: "completed" as const, ticketId: 556 };
      },
      getRecoveryItems: () => [],
      ticketService: () => ({}),
      resolveLocalFinalize: async () => {
        throw new Error("resolveLocalFinalize should not be called when reopen retry succeeds");
      },
    } as unknown as ReturnType<typeof import("../app/syncEngine").createSyncEngine>;

    let warningCalls = 0;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        (async () => {
          warningCalls++;
          return undefined;
        }) as unknown as typeof originalShowWarningMessage;

      const result = await syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 556 } },
        {
          suppressResultNotifications: true,
          createTicketSyncService: (() => ({})) as never,
          createSyncEngine: (() => fakeEngine) as never,
        },
      );
      assert.strictEqual(syncOneCalls, 2);
      assert.strictEqual(openedBeforeRetry, true);
      assert.strictEqual(warningCalls, 0);
      assert.deepStrictEqual(result, { status: "success", kind: "ticket", id: 556, hasRemainingChanges: true });
    } finally {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        originalShowWarningMessage;
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("local_finalize_pending で閉じられたファイルが開けない場合は確認モーダルへフォールバックする", async () => {
    const metadata = buildIssueMetadataFixture();
    const scope = getCurrentConnectionScope();
    const missingUri = vscode.Uri.file(path.join(os.tmpdir(), `non-existent-${Date.now()}.md`)).toString();

    await addOfflineTicketUpdateAsync(557, {
      ticketId: 557,
      operationId: "ticket:557",
      baseSubject: "Base",
      baseDescription: "Base",
      baseMetadata: metadata,
      subject: "Updated",
      description: "Updated body",
      metadata,
      documentUri: missingUri,
      phase: "local_finalize_pending",
    }, scope);

    let syncOneCalls = 0;
    const fakeEngine = {
      syncOne: async () => {
        syncOneCalls++;
        return {
          kind: "remote_committed" as const,
          ticketId: 557,
          pending: "local_finalize" as const,
          message: "Document is closed or not available",
        };
      },
      getRecoveryItems: () => [],
      ticketService: () => ({}),
      resolveLocalFinalize: async () => ({ kind: "completed" as const, ticketId: 557 }),
    } as unknown as ReturnType<typeof import("../app/syncEngine").createSyncEngine>;

    let warningCalls = 0;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        (async () => {
          warningCalls++;
          return undefined;
        }) as unknown as typeof originalShowWarningMessage;

      const result = await syncUnsyncedFile(
        { syncKey: { kind: "ticket", ticketId: 557 } },
        {
          suppressResultNotifications: true,
          createTicketSyncService: (() => ({})) as never,
          createSyncEngine: (() => fakeEngine) as never,
        },
      );
      assert.strictEqual(syncOneCalls, 1);
      assert.strictEqual(warningCalls, 1);
      assert.deepStrictEqual(result, { status: "cancelled", kind: "ticket" });
    } finally {
      (vscode.window as unknown as { showWarningMessage: typeof originalShowWarningMessage }).showWarningMessage =
        originalShowWarningMessage;
    }
  });
});
