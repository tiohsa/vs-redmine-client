import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { createSyncEngine } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { addOfflineTicketUpdateAsync, getOfflineSyncQueue, initializeOfflineSyncStore, replaceOfflineSyncQueueAsync } from "../views/offlineSyncStore";
import { clearConflictContext, registerConflictContext } from "../views/conflictDiffProvider";
import { clearRegistry, registerTicketEditor } from "../views/ticketEditorRegistry";
import type { ConflictContext } from "../views/ticketSaveTypes";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createEditorStub } from "./helpers/editorStubs";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("Dashboard conflict review", () => {
  const ticketId = 72;
  const uri = "test://tickets/72";
  const scope = getCurrentConnectionScope();
  const originalOpenTextDocument = vscode.workspace.openTextDocument;
  const originalShowTextDocument = vscode.window.showTextDocument;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  let editor: vscode.TextEditor;
  let service: DashboardUnsyncedService;
  let openTicketEditorCalls: number;
  let syncAttempts: number;
  let openedUris: string[];
  let errors: string[];
  let warningChoices: string[];
  let registeredEditor: vscode.TextEditor | undefined;

  const conflictContext = (): ConflictContext => ({
    connectionScope: scope,
    ticketId,
    baseSubject: "Base",
    baseDescription: "Base description",
    localSubject: "Local",
    localDescription: "Local description",
    remoteSubject: "Remote",
    remoteDescription: "Remote description",
    remoteMetadata: { tracker: "", priority: "", status: "", due_date: "" },
    remoteUpdatedAt: "2026-09-22T00:00:00Z",
  });

  const registerEditor = (): void => {
    registeredEditor = editor;
    registerTicketEditor(ticketId, editor, "primary", "ticket", 4, scope);
  };

  setup(async () => {
    clearRegistry();
    clearConflictContext(ticketId, scope);
    initializeOfflineSyncStore(createTestMemento(), scope);
    editor = createEditorStub(vscode.Uri.parse(uri), "Local");
    registeredEditor = undefined;
    openTicketEditorCalls = 0;
    syncAttempts = 0;
    openedUris = [];
    errors = [];
    warningChoices = [];
    registerConflictContext(conflictContext());

    const engine = createSyncEngine();
    engine.syncOne = async () => {
      syncAttempts++;
      return { kind: "completed", ticketId };
    };
    service = new DashboardUnsyncedService({
      context: {
        store: new DashboardStateStore(),
        notifySuccess: () => undefined,
        notifyError: (_requestId, message) => { errors.push(message); },
        notifyToast: () => undefined,
        notifyOperationStarted: () => undefined,
        onTicketsRefreshed: () => undefined,
      },
      refreshTicketPresentation: () => undefined,
      loadComments: async () => undefined,
      openTicketEditor: async (requestedTicketId) => {
        assert.strictEqual(requestedTicketId, ticketId);
        openTicketEditorCalls++;
        registerEditor();
      },
      syncEngine: engine,
    });

    vscode.workspace.openTextDocument = (async (documentUri: vscode.Uri) => {
      openedUris.push(documentUri.toString());
      return editor.document;
    }) as unknown as typeof vscode.workspace.openTextDocument;
    vscode.window.showTextDocument = (async (document: vscode.TextDocument) => {
      assert.strictEqual(document, editor.document);
      return editor;
    }) as unknown as typeof vscode.window.showTextDocument;
    vscode.window.showWarningMessage = (async (...args: unknown[]) => {
      warningChoices = args.slice(2).filter((value): value is string => typeof value === "string");
      return undefined;
    }) as unknown as typeof vscode.window.showWarningMessage;
  });

  teardown(() => {
    vscode.workspace.openTextDocument = originalOpenTextDocument;
    vscode.window.showTextDocument = originalShowTextDocument;
    vscode.window.showWarningMessage = originalShowWarningMessage;
    clearConflictContext(ticketId, scope);
    clearRegistry();
  });

  test("既に開いている editor はそのまま既存の native conflict resolver に渡す", async () => {
    registerEditor();
    await service.handleReviewConflict("review", ticketId);

    assert.strictEqual(openTicketEditorCalls, 0);
    assert.deepStrictEqual(openedUris, [uri]);
    assert.ok(warningChoices.includes("Local Priority"));
    assert.ok(warningChoices.includes("Remote Priority"));
    assert.ok(warningChoices.includes("Merge Changes"));
    assert.strictEqual(syncAttempts, 0);
  });

  test("editor がない場合は開いてから既存 resolver を呼び、再同期しない", async () => {
    await service.handleReviewConflict("review", ticketId);

    assert.strictEqual(openTicketEditorCalls, 1);
    assert.ok(registeredEditor);
    assert.deepStrictEqual(openedUris, [uri]);
    assert.ok(warningChoices.includes("Local Priority"));
    assert.strictEqual(syncAttempts, 0);
  });

  test("別 connection scope の conflict context は開かず拒否する", async () => {
    clearConflictContext(ticketId, scope);
    registerConflictContext({ ...conflictContext(), connectionScope: "https://other.example/" });
    await service.handleReviewConflict("review", ticketId);

    assert.strictEqual(openTicketEditorCalls, 0);
    assert.deepStrictEqual(openedUris, []);
    assert.deepStrictEqual(warningChoices, []);
    assert.strictEqual(syncAttempts, 0);
    assert.strictEqual(errors.length, 1);
  });

  test("保存済み conflict context の queue revision が変わったら resolver を開かない", async () => {
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      baseSubject: "Base",
      baseDescription: "Base description",
      baseMetadata: { tracker: "", priority: "", status: "", due_date: "" },
      subject: "Local",
      description: "Local description",
      metadata: { tracker: "", priority: "", status: "", due_date: "" },
      operationId: "ticket:72",
      connectionScope: scope,
      revision: 2,
      intentRevision: 2,
    }, scope);
    const queue = getOfflineSyncQueue(scope);
    const originalOperation = queue.tickets.get(ticketId);
    assert.ok(originalOperation);
    registerConflictContext(conflictContext(), originalOperation);
    const changed = new Map(queue.tickets);
    changed.set(ticketId, { ...originalOperation, revision: 3, intentRevision: 3, content: "new revision" });
    await replaceOfflineSyncQueueAsync({ ...queue, tickets: changed }, scope);

    await service.handleReviewConflict("review", ticketId);

    assert.strictEqual(openTicketEditorCalls, 0);
    assert.deepStrictEqual(warningChoices, []);
    assert.strictEqual(syncAttempts, 0);
    assert.strictEqual(errors.length, 1);
  });

  test("resolver を開いている間に queue revision が変われば stale resolution を拒否する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      baseSubject: "Base",
      baseDescription: "Base description",
      baseMetadata: { tracker: "", priority: "", status: "", due_date: "" },
      subject: "Local",
      description: "Local description",
      metadata: { tracker: "", priority: "", status: "", due_date: "" },
      operationId: "ticket:72",
      connectionScope: scope,
      revision: 2,
      intentRevision: 2,
    }, scope);
    const originalOperation = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.ok(originalOperation);
    registerConflictContext(conflictContext(), originalOperation);
    registerEditor();

    let chooseRemote!: () => void;
    vscode.window.showWarningMessage = (() => new Promise<string>((resolve) => {
      chooseRemote = () => resolve("Remote Priority");
    })) as typeof vscode.window.showWarningMessage;
    const review = service.handleReviewConflict("review", ticketId);
    await Promise.resolve();
    await Promise.resolve();
    const queue = getOfflineSyncQueue(scope);
    const current = queue.tickets.get(ticketId);
    assert.ok(current);
    const changed = new Map(queue.tickets);
    changed.set(ticketId, { ...current, revision: 3, intentRevision: 3, content: "new revision" });
    await replaceOfflineSyncQueueAsync({ ...queue, tickets: changed }, scope);
    chooseRemote();
    await review;

    assert.strictEqual(syncAttempts, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.revision, 3);
  });

  test("専用 request は有効な ticketId を検証し、不正な ID を拒否する", () => {
    const valid = validateDashboardMessage({ type: "ticket.reviewConflict", requestId: "r1", ticketId });
    const invalid = validateDashboardMessage({ type: "ticket.reviewConflict", requestId: "r2", ticketId: 0 });
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(invalid.ok, false);
  });
});
