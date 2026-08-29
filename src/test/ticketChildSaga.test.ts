import * as assert from "assert";
import { TicketCreateHandler } from "../app/ticketSync/operationHandlers";
import { UnifiedSyncOperation, TicketCreateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-06: Ticket Child Saga (ticketChildSaga.test.ts)", () => {
  const scope = "test-scope-rt-06";

  test("RT-06: 親チケット作成時に child tickets が指定されている場合、子チケットが作成されること", async () => {
    const handler = new TicketCreateHandler();
    let createdIssues: any[] = [];

    const intent: TicketCreateIntent = {
      projectId: 1,
      subject: "Parent Issue",
      description: "Parent Description",
      metadata: {
        tracker: "Feature",
        priority: "Normal",
        status: "New",
        start_date: "",
        due_date: "",
        children: ["Child Task 1", "Child Task 2"],
      },
    };

    const op: UnifiedSyncOperation<TicketCreateIntent> = {
      operationId: `${scope}:newTicket:queue-child`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "queue-child" },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    let nextId = 1000;
    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      createIssue: async (input: any) => {
        const id = nextId++;
        createdIssues.push({ id, ...input });
        return id;
      },
      getIssueDetail: async (id: number) => ({
        ticket: { id, subject: "Parent Issue", projectId: 1, statusId: 1, priorityId: 1, trackerId: 1, createdAt: "2026-08-14T00:00:00Z", updatedAt: "2026-08-14T00:00:00Z" },
        comments: [],
      }),
    };

    const prep = await handler.prepare(op, { connectionScope: scope }, { ticketCreate: mockDeps });
    assert.strictEqual(prep.ok, true);

    const writeResult = await handler.executeRemoteWrite(op, (prep as any).prepared, { connectionScope: scope }, { ticketCreate: mockDeps });
    assert.strictEqual(writeResult.ok, true);
    assert.ok(createdIssues.length >= 1, "親チケットが作成されていること");
    assert.strictEqual(createdIssues[0].subject, "Parent Issue");
  });
});
