import * as assert from "assert";
import { TicketUpdateHandler } from "../app/ticketSync/operationHandlers";
import { UnifiedSyncOperation, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-05: TicketUpdateHandler Parity (ticketUpdateHandlerParity.test.ts)", () => {
  const scope = "test-scope-rt-05";

  test("RT-05: TicketUpdateIntent の全 metadata (assignee, dates clear, done_ratio, estimated_hours, empty description) が正しく updateIssue に反映されること", async () => {
    const handler = new TicketUpdateHandler();
    let updatedIssueInput: any = undefined;

    const intent: TicketUpdateIntent = {
      ticketId: 101,
      baseSubject: "Old Subject",
      baseDescription: "Old Desc",
      baseMetadata: {
        tracker: "Bug",
        priority: "Low",
        status: "New",
        assignee: "Alice Smith",
        start_date: "2026-08-01",
        due_date: "2026-08-10",
        done_ratio: 0,
        estimated_hours: 5,
        children: [],
      },
      subject: "New Subject",
      description: "", // 空文字への更新 (INV-21)
      metadata: {
        tracker: "Feature",
        priority: "Immediate",
        status: "Resolved",
        assignee: "Bob Jones", // 担当者変更
        start_date: "", // クリア
        due_date: "", // クリア
        done_ratio: 80,
        estimated_hours: 12,
        children: [],
      },
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
      listProjectMembers: async () => [
        { id: 10, name: "Alice Smith", userId: 10 },
        { id: 20, name: "Bob Jones", userId: 20 },
      ],
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
    if (!prep.ok) {
      console.log("prep error:", (prep as any).outcome?.error?.message ?? (prep as any).outcome);
    }
    assert.strictEqual(prep.ok, true);

    const writeResult = await handler.executeRemoteWrite(op, (prep as any).prepared, { connectionScope: scope }, { ticketUpdate: mockDeps });
    assert.strictEqual(writeResult.ok, true);
    assert.ok(updatedIssueInput, "updateIssue が呼ばれていること");
    assert.strictEqual(updatedIssueInput.issueId, 101);
    assert.strictEqual(updatedIssueInput.fields.subject, "New Subject");
    assert.strictEqual(updatedIssueInput.fields.description, "", "空文字の説明文が渡されていること");
    assert.strictEqual(updatedIssueInput.fields.trackerId, 2, "trackerId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.statusId, 3, "statusId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.priorityId, 5, "priorityId が解決されていること");
    assert.strictEqual(updatedIssueInput.fields.assignedToId, 20, "担当者IDが解決されていること");
    assert.strictEqual(updatedIssueInput.fields.startDate, null, "startDate のクリアが渡されていること");
    assert.strictEqual(updatedIssueInput.fields.dueDate, null, "dueDate のクリアが渡されていること");
    assert.strictEqual(updatedIssueInput.fields.doneRatio, 80, "doneRatio が渡されていること");
    assert.strictEqual(updatedIssueInput.fields.estimatedHours, 12, "estimatedHours が渡されていること");
  });

  test("RT-05: 担当者のアンアサイン (unassign / 空白) が assignedToId: '' または undefined で反映されること", async () => {
    const handler = new TicketUpdateHandler();
    let updatedIssueInput: any = undefined;

    const intent: TicketUpdateIntent = {
      ticketId: 102,
      baseSubject: "Subject",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Low", status: "New", assignee: "Alice Smith", due_date: "", children: [] },
      subject: "Subject",
      description: "Desc",
      metadata: { tracker: "Bug", priority: "Low", status: "New", assignee: "", due_date: "", children: [] }, // unassign
    };

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:102`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 102 },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      ticketId: 102,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 1, name: "Bug" }],
      listIssuePriorities: async () => [{ id: 1, name: "Low" }],
      listProjectMembers: async () => [{ id: 10, name: "Alice Smith", userId: 10 }],
      getIssueDetail: async (id: number) => ({
        ticket: { id, subject: "Subject", projectId: 10, statusId: 1, priorityId: 1, trackerId: 1, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" },
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
    assert.ok(updatedIssueInput);
    assert.strictEqual(updatedIssueInput.fields.assignedToId, "", "アンアサインが空文字で指定されること");
  });

  test("RT-05: 存在しない tracker/status/priority が指定された場合は明確なエラー (failed_before_commit) になること", async () => {
    const handler = new TicketUpdateHandler();

    const intent: TicketUpdateIntent = {
      ticketId: 103,
      baseSubject: "Subject",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Low", status: "New", due_date: "", children: [] },
      subject: "Subject",
      description: "Desc",
      metadata: { tracker: "NonExistentTracker", priority: "Low", status: "New", due_date: "", children: [] },
    };

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:103`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 103 },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      ticketId: 103,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 1, name: "Bug" }], // NonExistentTracker が存在しない
      listIssuePriorities: async () => [{ id: 1, name: "Low" }],
      getIssueDetail: async (id: number) => ({
        ticket: { id, subject: "Subject", projectId: 10, statusId: 1, priorityId: 1, trackerId: 1, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" },
        comments: [],
      }),
      updateIssue: async () => undefined,
    };

    const prep = await handler.prepare(op, { connectionScope: scope }, { ticketUpdate: mockDeps });
    assert.strictEqual(prep.ok, false, "未知のトラッカーは prepare でエラーになること");
    assert.strictEqual(prep.outcome.kind, "failed_before_commit");
  });
});
