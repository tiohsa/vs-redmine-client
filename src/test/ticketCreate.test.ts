import * as assert from "assert";
import { buildIssueCreatePayload } from "../redmine/issues";
import { syncNewTicketDraftContent } from "../views/ticketSaveSync";
import {
  buildTicketEditorMetadataContent,
  buildTicketEditorMetadataContentWithChildren,
} from "./helpers/ticketEditorMetadataStubs";

suite("Ticket creation payload", () => {
  test("builds payload from editor content", () => {
    const payload = buildIssueCreatePayload({
      projectId: 10,
      subject: "Sample",
      description: "Body",
      uploads: [
        {
          token: "token",
          filename: "image.png",
          content_type: "image/png",
        },
      ],
    });

    assert.deepStrictEqual(payload, {
      issue: {
        project_id: 10,
        subject: "Sample",
        description: "Body",
        uploads: [
          {
            token: "token",
            filename: "image.png",
            content_type: "image/png",
          },
        ],
      },
    });
  });

  test("creates parent and children tickets", async () => {
    const created: Array<{
      projectId: number;
      subject: string;
      description: string;
      statusId?: number;
      trackerId?: number;
      priorityId?: number;
      dueDate?: string;
      parentId?: number;
    }> = [];
    let nextId = 100;

    const deps = {
      createIssue: async (input: typeof created[number]) => {
        created.push(input);
        return nextId++;
      },
      deleteIssue: async () => undefined,
      listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
      listTrackers: async () => [{ id: 2, name: "Task" }],
      listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
    };

    const content = buildTicketEditorMetadataContentWithChildren(
      "Parent Ticket",
      "Parent body",
      ["Child task 1", "Child task 2"],
    );

    const result = await syncNewTicketDraftContent({
      content,
      projectId: 10,
      deps,
    });

    assert.strictEqual(result.status, "created");
    assert.strictEqual(created.length, 3);
    assert.strictEqual(created[0].subject, "Parent Ticket");
    assert.strictEqual(created[1].parentId, 100);
    assert.strictEqual(created[2].parentId, 100);
  });

  test("creates only parent when children not provided", async () => {
    const created: Array<{
      projectId: number;
      subject: string;
      description: string;
      parentId?: number;
    }> = [];

    const deps = {
      createIssue: async (input: typeof created[number]) => {
        created.push(input);
        return 200;
      },
      deleteIssue: async () => undefined,
      listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
      listTrackers: async () => [{ id: 2, name: "Task" }],
      listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
    };

    const content = buildTicketEditorMetadataContent(
      "Parent Ticket",
      "Parent body",
    );

    const result = await syncNewTicketDraftContent({
      content,
      projectId: 10,
      deps,
    });

    assert.strictEqual(result.status, "created");
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].parentId, undefined);
  });

  test("uses parent metadata when creating a child ticket", async () => {
    const created: Array<{
      projectId: number;
      subject: string;
      description: string;
      parentId?: number;
    }> = [];

    const deps = {
      createIssue: async (input: typeof created[number]) => {
        created.push(input);
        return 400;
      },
      deleteIssue: async () => undefined,
      listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
      listTrackers: async () => [{ id: 2, name: "Task" }],
      listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
    };

    const content = buildTicketEditorMetadataContent(
      "Child Ticket",
      "Child body",
      { parent: 321 },
    );

    const result = await syncNewTicketDraftContent({
      content,
      projectId: 10,
      deps,
    });

    assert.strictEqual(result.status, "created");
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].parentId, 321);
  });

  test("rolls back when child creation fails", async () => {
    const created: Array<{ subject: string; parentId?: number }> = [];
    const deleted: number[] = [];
    let nextId = 300;

    const deps = {
      createIssue: async (input: { subject: string; parentId?: number }) => {
        if (input.subject === "Child task 2") {
          throw new Error("Child failure");
        }
        created.push(input);
        return nextId++;
      },
      deleteIssue: async (issueId: number) => {
        deleted.push(issueId);
      },
      listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
      listTrackers: async () => [{ id: 2, name: "Task" }],
      listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
    };

    const content = buildTicketEditorMetadataContentWithChildren(
      "Parent Ticket",
      "Parent body",
      ["Child task 1", "Child task 2"],
    );

    const result = await syncNewTicketDraftContent({
      content,
      projectId: 10,
      deps,
    });

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(created.length, 2);
    assert.deepStrictEqual(deleted, [300, 301]);
  });
});
