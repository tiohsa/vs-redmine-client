import * as assert from "assert";
import * as vscode from "vscode";
import { performSyncOnSave } from "../app/saveSyncExecutor";
import type { SaveSyncExecutorDeps } from "../app/saveSyncExecutor";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { resolveTicketSyncState } from "../dashboard/viewModels/ticketDashboardViewModel";
import { clearOfflineSyncQueueAsync, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { clearTicketDrafts, getTicketDraft, initializeTicketDraft } from "../views/ticketDraftStore";
import { clearRegistry, registerTicketEditor } from "../views/ticketEditorRegistry";
import type { ConflictContext, TicketDraftStatus, TicketSaveStatus } from "../views/ticketSaveTypes";
import { createMutableEditorStub, createTicketContentFixture } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("自動同期の競合解決後の状態復旧", () => {
  const scope = getCurrentConnectionScope();
  const ticketId = 9201;
  const presentation = {
    refresh: () => undefined,
    notifyChange: () => undefined,
    refreshForTicket: () => undefined,
    updateTicketSubject: () => undefined,
    setSelectedProjectId: async () => undefined,
  };

  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);
    clearRegistry();
  });

  teardown(async () => {
    clearRegistry();
    clearTicketDrafts(scope);
    await clearOfflineSyncQueueAsync(scope);
  });

  const cases: Array<{ result: TicketSaveStatus; expected: TicketDraftStatus }> = [
    { result: "conflict", expected: "Conflict" },
    { result: "failed", expected: "Failed" },
    { result: "merged", expected: "Dirty" },
    { result: "queued", expected: "Queued" },
    { result: "success", expected: "Synced" },
    { result: "no_change", expected: "Synced" },
  ];

  for (const { result, expected } of cases) {
    test(`${result} の結果を通知する前に Syncing を解除し、次の同期へ進める`, async () => {
      const metadata = buildIssueMetadataFixture();
      initializeTicketDraft(ticketId, "Title", "Base", metadata, "old", scope);
      const editor = createMutableEditorStub(
        vscode.Uri.file(`/tmp/project-1_ticket-${ticketId}.md`),
        createTicketContentFixture("Title", "Local"),
      );
      registerTicketEditor(ticketId, editor, "primary", "ticket", 1, scope);
      const context: ConflictContext = {
        ticketId,
        baseSubject: "Title",
        localSubject: "Title",
        remoteSubject: "Title",
        baseDescription: "Base",
        localDescription: "Local",
        remoteDescription: "Remote",
        remoteMetadata: metadata,
        remoteUpdatedAt: "new",
        connectionScope: scope,
      };
      let syncCalls = 0;
      let resolved = false;
      const deps: SaveSyncExecutorDeps = {
        ticketsPresentation: presentation,
        commentsPresentation: presentation,
        unsyncedPresentation: presentation,
        notifications: {
          notifyTicketSaveResult: (notification) => {
            if (resolved && notification?.status === result) {
              assert.strictEqual(getTicketDraft(ticketId, scope)?.status, expected);
            }
          },
          notifyCommentSaveResult: () => undefined,
        },
        updateTicketListSubject: () => undefined,
        offlineSyncMode: "auto",
        syncEngine: {
          syncOne: async () => {
            syncCalls++;
            return syncCalls === 1
              ? { kind: "conflict", ticketId, conflictContext: context }
              : { kind: "completed", ticketId };
          },
        },
        resolveTicketConflict: async () => {
          assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Syncing");
          resolved = true;
          return { status: result, message: "競合解決の結果", conflictContext: context };
        },
      };

      await performSyncOnSave(editor.document, editor, deps);

      assert.ok(resolved);
      assert.strictEqual(getTicketDraft(ticketId, scope)?.status, expected);
      assert.notStrictEqual(resolveTicketSyncState(ticketId), "Syncing");
      deps.notifications.notifyTicketSaveResult = () => undefined;
      await performSyncOnSave(editor.document, editor, deps);
      assert.strictEqual(syncCalls, 2);
      assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Synced");
    });
  }
});
