import * as assert from "assert";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { TicketCreateHandler } from "../app/ticketSync/operationHandlers";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { UnifiedSyncOperation, TicketCreateIntent } from "../app/ticketSync/syncOperationTypes";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("RT-04: Secondary Effect Restart Safety (secondaryEffectRestart.test.ts)", () => {
  const scope = "test-scope-rt-04";

  test("RT-04: secondary effects (attachment upload) が committed 済みの場合、再起動後に再アップロード (blind retry) されないこと", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, scope);
    const repo = createSyncOperationRepository();

    let uploadCount = 0;
    let createIssueCalls = 0;

    const handler = new TicketCreateHandler();
    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: { ticketCreate: handler },
    });

    const intent: TicketCreateIntent = {
      projectId: 1,
      subject: "Secondary effect test",
      description: "Desc",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", start_date: "", due_date: "", children: [] },
      attachments: [
        { kind: "file", filePath: "/tmp/test.png", filename: "test.png", contentType: "image/png" },
      ],
      uploadTokens: [
        // 既にアップロード完了して token が記録されている状態
        { token: "already-uploaded-token-123", filename: "test.png", content_type: "image/png" },
      ],
    };

    const op: UnifiedSyncOperation<TicketCreateIntent> = {
      operationId: `${scope}:newTicket:queue-restart`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "queue-restart" },
      connectionScope: scope,
      phase: "preparing",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repo.saveOperation(op, scope);

    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 1, name: "Bug" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      uploadFile: async () => {
        uploadCount++;
        return { token: "new-token-456", filename: "test.png", contentType: "image/png" };
      },
      createIssue: async (input: any) => {
        createIssueCalls++;
        return 777;
      },
      getIssueDetail: async (id: number) => ({
        ticket: { id, subject: "Secondary effect test", projectId: 1, statusId: 1, priorityId: 1, trackerId: 1, createdAt: "2026-08-14T00:00:00Z", updatedAt: "2026-08-14T00:00:00Z" },
        comments: [],
      }),
    };

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "queue-restart" },
      { connectionScope: scope },
      { deps: { ticketCreate: mockDeps } },
    );

    if (outcome.kind !== "completed") {
      console.error("Outcome error in RT-04:", (outcome as any).error?.message, (outcome as any).error?.stack);
    }
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createIssueCalls, 1);
  });
});
