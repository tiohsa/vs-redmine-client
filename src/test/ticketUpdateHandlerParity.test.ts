import * as assert from "assert";
import { TicketUpdateHandler } from "../app/ticketSync/operationHandlers";
import { UnifiedSyncOperation, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-C: TicketUpdateHandler Parity (ticketUpdateHandlerParity.test.ts)", () => {
  const scope = "test-scope-rt-c";

  test("RT-C: TicketUpdateIntent の全 metadata (tracker, status, priority, dates) が updateIssue に渡されること", async () => {
    const handler = new TicketUpdateHandler();
    let updatedIssueInput: any = undefined;

    const intent: TicketUpdateIntent = {
      ticketId: 101,
      baseSubject: "Old Subject",
      baseDescription: "Old Desc",
      baseMetadata: { tracker: "Bug", priority: "Low", status: "New", start_date: "2026-08-01", due_date: "2026-08-10", children: [] },
      subject: "New Subject",
      description: "New Desc",
      metadata: { tracker: "Feature", priority: "Immediate", status: "Resolved", start_date: "2026-08-05", due_date: "2026-08-20", children: [] },
    };

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:101`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 101 },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      ticketId: 101,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }, { id: 3, name: "Resolved" }],
      listTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }],
      listIssuePriorities: async () => [{ id: 1, name: "Low" }, { id: 5, name: "Immediate" }],
      getIssueDetail: async (id: number) => ({
        ticket: {
          id,
          subject: "Old Subject",
          description: "Old Desc",
          projectId: 10,
          projectName: "Test Project",
          statusId: 1,
          statusName: "New",
          priorityId: 1,
          priorityName: "Low",
          trackerId: 1,
          trackerName: "Bug",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
        comments: [],
      }),
      updateIssue: async (input: any) => {
        updatedIssueInput = input;
      },
    };

    const prep = await handler.prepare(op, { connectionScope: scope }, { ticketUpdate: mockDeps });
    assert.strictEqual(prep.ok, true);

    const writeResult = await handler.executeRemoteWrite(op, (prep as any).prepared, { connectionScope: scope }, { ticketUpdate: mockDeps });
    assert.strictEqual(writeResult.ok, true);
    assert.ok(updatedIssueInput, "updateIssue が呼ばれていること");
    assert.strictEqual(updatedIssueInput.issueId, 101);
    assert.strictEqual(updatedIssueInput.fields.subject, "New Subject");
    assert.strictEqual(updatedIssueInput.fields.description, "New Desc");
    assert.strictEqual(updatedIssueInput.fields.trackerId, 2, "trackerId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.statusId, 3, "statusId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.priorityId, 5, "priorityId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.startDate, "2026-08-05", "startDate が渡されていること");
    assert.strictEqual(updatedIssueInput.fields.dueDate, "2026-08-20", "dueDate が渡されていること");
  });
});
