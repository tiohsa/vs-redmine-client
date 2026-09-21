import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardMetadataService } from "../dashboard/services/DashboardMetadataService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { Ticket } from "../redmine/types";
import { addOfflineTicketUpdateAsync, getOfflineSyncQueue, initializeOfflineSyncStore, updateQueuedTicketIntentAsync, type OfflineTicketUpdate } from "../views/offlineSyncStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { clearRegistry, registerTicketDocument } from "../views/ticketEditorRegistry";
import { clearTicketDrafts, getTicketDraft, getTicketDraftContent, initializeDraftStore, initializeTicketDraft, markDraftStatus, setTicketDraftContent } from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("Dashboard metadata — durable snapshot", () => {
  const ticketId = 8234;
  const metadata = buildIssueMetadataFixture();
  let scope: string;
  let storage: ReturnType<typeof createTestMemento>;
  let service: DashboardMetadataService;
  let update: OfflineTicketUpdate;
  let success: number;
  setup(() => {
    scope = getCurrentConnectionScope();
    storage = createTestMemento();
    initializeOfflineSyncStore(storage, scope);
    initializeDraftStore(createInMemoryDraftStorage(), scope);
    clearRegistry();
    success = 0;
    const ticket: Ticket = {
      id: ticketId, subject: "Base", description: "Base body", projectId: 1,
      trackerName: metadata.tracker, priorityName: metadata.priority, statusName: metadata.status,
      dueDate: metadata.due_date, startDate: metadata.start_date,
    };
    update = {
      ticketId, baseSubject: "Base", baseDescription: "Base body", baseMetadata: metadata,
      subject: "Edited", description: "Edited body", metadata,
      layout: "metadata-first", controlFields: { issue_id: ticketId, project_id: 1, lock_version: 8 },
    };
    update.content = buildTicketEditorContent(update);
    initializeTicketDraft(ticketId, ticket.subject, ticket.description!, metadata, undefined, scope);
    setTicketDraftContent(ticketId, update, scope);
    markDraftStatus(ticketId, "Dirty", scope);
    const store = new DashboardStateStore();
    store.update({ metadataOptions: { trackers: [], priorities: [{ id: 2, name: "High" }], statuses: [{ id: 2, name: "Closed" }] } });
    service = new DashboardMetadataService({
      context: {
        store, notifyOperationStarted: () => {}, notifySuccess: () => { success++; },
        notifyError: (_id, message) => { assert.fail(message); }, notifyToast: () => {}, onTicketsRefreshed: () => {},
      },
      getTickets: () => [ticket], isMetadataOptionsLoaded: () => true,
      refreshUnsynced: () => {}, pushTickets: () => {}, openEditor: async () => { assert.fail("unexpected editor open"); },
    });
  });
  teardown(async () => {
    clearRegistry();
    clearTicketDrafts(scope);
    initializeOfflineSyncStore(createTestMemento(), scope);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("キューだけの編集で metadata・本文・制御フィールドを一緒に永続化する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, update, scope);
    await service.updateTicketMetadata("metadata", ticketId, { priority: "High" });
    const queued = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
    assert.strictEqual(queued.metadata.priority, "High");
    assert.strictEqual(queued.content, buildTicketEditorContent(queued));
    assert.deepStrictEqual(queued.controlFields, update.controlFields);
    assert.strictEqual(parseTicketEditorContent(queued.content!).metadata.priority, "High");
    assert.strictEqual(getTicketDraftContent(ticketId, scope)?.metadata.priority, "High");
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Queued");
    initializeOfflineSyncStore(storage, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.content, queued.content);
    assert.strictEqual(success, 1);
  });

  test("開いているEditorとqueueのsnapshotが一致してCAS条件を満たす", async () => {
    await addOfflineTicketUpdateAsync(ticketId, update, scope);
    const document = await vscode.workspace.openTextDocument({ language: "markdown", content: update.content });
    registerTicketDocument(ticketId, document, "ticket", 1, scope);
    await service.updateTicketMetadata("metadata", ticketId, { priority: "High" });
    const queued = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
    assert.strictEqual(queued.content, document.getText());
    assert.strictEqual(queued.metadata.priority, "High");
    assert.deepStrictEqual(queued.controlFields, update.controlFields);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Queued");
  });

  test("復旧中は既存nextIntentを編集しactive snapshotを保持する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, { ...update, phase: "commit_unknown", revision: 4 }, scope);
    await addOfflineTicketUpdateAsync(ticketId, { ...update, subject: "Later", description: "Later body", content: undefined }, scope);
    const before = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
    await service.updateTicketMetadata("metadata", ticketId, { priority: "High" });
    await service.updateTicketMetadata("metadata2", ticketId, { status: "Closed" });
    const after = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
    assert.deepStrictEqual({ ...after, nextIntent: undefined }, { ...before, nextIntent: undefined });
    assert.strictEqual(after.nextIntent?.subject, "Later");
    assert.strictEqual(after.nextIntent?.description, "Later body");
    assert.strictEqual(after.nextIntent?.metadata.priority, "High");
    assert.strictEqual(after.nextIntent?.metadata.status, "Closed");
    assert.strictEqual(after.nextIntent?.content, buildTicketEditorContent(after.nextIntent!));
    assert.strictEqual(after.nextIntent?.revision, before.nextIntent!.revision + 2);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");
  });

  test("永続化失敗ではdraftの本文と状態を先行させない", async () => {
    await addOfflineTicketUpdateAsync(ticketId, update, scope);
    const queueBefore = getOfflineSyncQueue(scope);
    const contentBefore = getTicketDraftContent(ticketId, scope);
    storage.update = async () => { throw new Error("injected persistence failure"); };
    await assert.rejects(service.updateTicketMetadata("metadata", ticketId, { priority: "High" }), /injected persistence failure/);
    assert.deepStrictEqual(getOfflineSyncQueue(scope), queueBefore);
    assert.deepStrictEqual(getTicketDraftContent(ticketId, scope), contentBefore);
    assert.strictEqual(getTicketDraft(ticketId, scope)?.status, "Dirty");
    assert.strictEqual(success, 0);
  });

  test("同時のintent更新をscope transaction内の最新snapshotへ適用する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, update, scope);
    await Promise.all([
      updateQueuedTicketIntentAsync(ticketId, scope, (current) => ({ ...current, subject: "Concurrent subject" })),
      updateQueuedTicketIntentAsync(ticketId, scope, (current) => ({ ...current, metadata: { ...current.metadata, priority: "High" } })),
    ]);
    const after = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
    assert.strictEqual(after.subject, "Concurrent subject");
    assert.strictEqual(after.metadata.priority, "High");
    assert.strictEqual(after.content, buildTicketEditorContent(after));
  });
});
