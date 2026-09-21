import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { createSyncEngine } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { clearRegistry, registerTicketEditor } from "../views/ticketEditorRegistry";
import { addOfflineCommentUpdateAsync, getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createEditorStub } from "./helpers/editorStubs";
import type { DashboardUnsyncedKey } from "../dashboard/dashboardProtocol";
import type { CommentConflictContext } from "../views/commentSaveTypes";

suite("Dashboard comment conflict identity", () => {
  const uri10 = "test://comments/10";
  const uri11 = "test://comments/11";
  const stopped = new Error("editor selection observed");
  let opened: string[];
  let errors: string[];
  let service: DashboardUnsyncedService;
  let context: CommentConflictContext;
  const originalOpen = vscode.workspace.openTextDocument;

  setup(async () => {
    clearRegistry();
    opened = [];
    errors = [];
    const scope = getCurrentConnectionScope();
    initializeOfflineSyncStore(createTestMemento(), scope);
    await addOfflineCommentUpdateAsync({ ticketId: 100, commentId: 10, body: "Local" }, scope);
    for (const [id, uri] of [[10, uri10], [11, uri11]] as const) {
      const record = registerTicketEditor(100, createEditorStub(vscode.Uri.parse(uri), "Local"), "primary", "comment");
      record.commentId = id;
      record.lastActiveAt = id;
    }
    context = { ticketId: 100, commentId: 10, baseBody: "Base", localBody: "Local", remoteBody: "Remote", connectionScope: scope };
    const engine = createSyncEngine();
    engine.syncOne = async () => ({ kind: "conflict", ticketId: 100, commentId: 10, message: "Conflict", commentConflictContext: context });
    service = new DashboardUnsyncedService({
      context: {
        store: new DashboardStateStore(),
        notifySuccess: () => assert.fail("must remain conflicted"),
        notifyError: (_id, message) => { errors.push(message); },
        notifyToast: () => undefined,
        notifyOperationStarted: () => undefined,
        onTicketsRefreshed: () => undefined,
      },
      refreshTicketPresentation: () => undefined,
      loadComments: async () => undefined,
      syncEngine: engine,
    });
    vscode.workspace.openTextDocument = async (uri) => {
      assert.ok(uri instanceof vscode.Uri);
      opened.push(uri.toString());
      throw stopped;
    };
  });
  teardown(() => {
    vscode.workspace.openTextDocument = originalOpen;
    clearRegistry();
  });

  for (const key of [
    { kind: "comment", ticketId: 100, commentId: 10 },
    { kind: "comment", ticketId: 100, documentUri: uri10 },
    { kind: "comment", ticketId: 100, commentId: 10, documentUri: uri10 },
  ] satisfies DashboardUnsyncedKey[]) {
    test(`利用可能な identity で Comment #10 を選ぶ ${JSON.stringify(key)}`, async () => {
      await assert.rejects(service.handleSyncOne("request", key), (error) => error === stopped);
      assert.deepStrictEqual(opened, [uri10]);
    });
  }

  for (const key of [
    { kind: "comment", ticketId: 100 },
    { kind: "comment", ticketId: 100, commentId: 10, documentUri: uri11 },
    { kind: "comment", ticketId: 100, commentId: 11 },
    { kind: "comment", ticketId: 999, commentId: 10 },
  ] satisfies DashboardUnsyncedKey[]) {
    test(`不足・不一致の identity は推測せず conflict と queue を保持 ${JSON.stringify(key)}`, async () => {
      const before = getOfflineSyncQueue();
      await service.handleSyncOne("request", key);
      assert.deepStrictEqual(opened, []);
      assert.strictEqual(errors.length, 1);
      assert.deepStrictEqual(getOfflineSyncQueue(), before);
    });
  }

  test("conflict context が別接続先なら Editor を開かない", async () => {
    context.connectionScope = "https://other.example/";
    await service.handleSyncOne("request", { kind: "comment", ticketId: 100, commentId: 10 });
    assert.deepStrictEqual(opened, []);
    assert.strictEqual(errors.length, 1);
  });
});
