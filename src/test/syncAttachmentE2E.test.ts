import * as assert from "assert";
import * as vscode from "vscode";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { TicketCreateHandler } from "../app/ticketSync/operationHandlers";
import { SyncOperationRepository } from "../app/ticketSync/syncRepository";
import { UnifiedSyncOperation, TicketCreateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-A: Attachment E2E Pipeline (syncAttachmentE2E.test.ts)", () => {
  const scope = "test-scope-rt-a";

  class InMemoryRepository implements SyncOperationRepository {
    private ops = new Map<string, UnifiedSyncOperation>();

    public getOperation(key: any, scope: string): UnifiedSyncOperation | undefined {
      return Array.from(this.ops.values()).find((o) => o.connectionScope === scope && o.key?.kind === key.kind && (o.key as any).queueId === (key as any).queueId);
    }
    public listOperations(scope: string): UnifiedSyncOperation[] {
      return Array.from(this.ops.values()).filter((o) => o.connectionScope === scope);
    }
    public async saveOperation(operation: UnifiedSyncOperation, scope: string): Promise<UnifiedSyncOperation> {
      this.ops.set(operation.operationId, operation);
      return operation;
    }
    public async transitionOperation(key: any, action: any, scope: string): Promise<UnifiedSyncOperation | undefined> {
      const op = this.getOperation(key, scope);
      if (!op) {return undefined;}
      let nextPhase = op.phase;
      if (action.kind === "begin_preparation") {nextPhase = "preparing";}
      if (action.kind === "start_normal_remote_write") {nextPhase = "remote_write_started";}
      if (action.kind === "record_remote_commit") {
        nextPhase = "remote_committed";
        op.createdRemoteId = action.createdRemoteId;
      }
      if (action.kind === "mark_reconciliation_pending") {nextPhase = "reconciliation_pending";}
      if (action.kind === "mark_local_finalize_pending") {nextPhase = "local_finalize_pending";}
      if (action.kind === "complete") {nextPhase = "completed";}
      const updated = { ...op, phase: nextPhase, version: (op.version ?? 1) + 1 };
      this.ops.set(op.operationId, updated);
      return updated;
    }
    public async completeOperation(key: any, scope: string): Promise<boolean> {
      const op = this.getOperation(key, scope);
      if (op) {this.ops.delete(op.operationId);}
      return true;
    }
    public async deleteOperation(key: any, scope: string): Promise<boolean> {
      return this.completeOperation(key, scope);
    }
  }

  test("RT-A: TicketCreateIntent の添付ファイルが secondary effects でアップロードされ createIssue に渡されること", async () => {
    const repo = new InMemoryRepository();
    const uploadedTokens: string[] = [];
    let createdIssuePayload: any = undefined;

    const handler = new TicketCreateHandler();
    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketCreate: handler,
      },
    });

    const intent: TicketCreateIntent = {
      projectId: 10,
      subject: "Ticket with Attachments",
      description: "Description text",
      metadata: { tracker: "Feature", priority: "High", status: "New", start_date: "", due_date: "", children: [] },
      attachments: [
        { kind: "file", filePath: "/path/to/image1.png", filename: "image1.png", contentType: "image/png" },
        { kind: "token", token: "pre-uploaded-token-123", filename: "existing.png", contentType: "image/png" },
      ],
    };

    const initialOp: UnifiedSyncOperation<TicketCreateIntent> = {
      operationId: `${scope}:newTicket:queue-1`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "queue-1" },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      projectId: 10,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repo.saveOperation(initialOp, scope);

    const mockCreateDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 2, name: "Feature" }],
      listIssuePriorities: async () => [{ id: 3, name: "High" }],
      uploadFile: async (filePath: string) => ({ token: "file-token-999", filename: "image1.png", contentType: "image/png" }),
      createIssue: async (input: any) => {
        createdIssuePayload = input;
        return 999;
      },
      getIssueDetail: async (id: number) => ({
        ticket: {
          id,
          subject: "Ticket with Attachments",
          description: "Description text",
          projectId: 10,
          projectName: "Test Project",
          statusId: 1,
          statusName: "New",
          priorityId: 3,
          priorityName: "High",
          trackerId: 2,
          trackerName: "Feature",
          createdAt: "2026-08-14T00:00:00Z",
          updatedAt: "2026-08-14T00:00:00Z",
        },
        comments: [],
      }),
    };

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "queue-1" },
      { connectionScope: scope },
      {
        deps: {
          ticketCreate: mockCreateDeps,
        },
      },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(outcome.ticketId, 999);
    assert.ok(createdIssuePayload, "createIssue が呼ばれていること");
    assert.strictEqual(createdIssuePayload.projectId, 10);
    assert.strictEqual(createdIssuePayload.subject, "Ticket with Attachments");
    assert.ok(createdIssuePayload.uploads, "uploads が createIssue に渡されていること");
    assert.strictEqual(createdIssuePayload.uploads.length, 2, "2件の添付ファイルが渡されていること");
    assert.strictEqual(createdIssuePayload.uploads[1].token, "pre-uploaded-token-123");
  });
});
