import * as assert from "assert";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
  setTicketDraftContent,
} from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { reloadTicketEditor, syncTicketDraft } from "../views/ticketSaveSync";
import { createEditorStub } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { buildTicketEditorMetadataContentWithChildren } from "./helpers/ticketEditorMetadataStubs";
import * as vscode from "vscode";

suite("Ticket save sync", () => {
  teardown(() => {
    clearTicketDrafts();
  });

  test("returns no_change when content matches base", async () => {
    initializeTicketDraft(1, "Title", "Body", buildIssueMetadataFixture(), "t1");

    const result = await syncTicketDraft({
      ticketId: 1,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 1, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("should not update");
        },
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "no_change");
  });

  test("returns conflict when remote updated", async () => {
    initializeTicketDraft(2, "Title", "Body", buildIssueMetadataFixture(), "t1");

    const result = await syncTicketDraft({
      ticketId: 2,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Updated",
        metadata: buildIssueMetadataFixture(),
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 2, subject: "Title", projectId: 1, updatedAt: "t2" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("should not update");
        },
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "conflict");
  });

  test("returns unreachable on server error", async () => {
    initializeTicketDraft(3, "Title", "Body", buildIssueMetadataFixture(), "t1");

    const result = await syncTicketDraft({
      ticketId: 3,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Updated",
        metadata: buildIssueMetadataFixture(),
      }),
      deps: {
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
        updateIssue: async () => {
          throw new Error("should not update");
        },
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "unreachable");
  });

  test("updates when changes exist and no conflict", async () => {
    initializeTicketDraft(4, "Title", "Body", buildIssueMetadataFixture(), "t1");

    const updatedAtValues = ["t1", "t2"];
    const result = await syncTicketDraft({
      ticketId: 4,
      content: buildTicketEditorContent({
        subject: "New",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 4,
            subject: "Title",
            projectId: 1,
            updatedAt: updatedAtValues.shift(),
          },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "success");
  });

  test("appends children on update and clears metadata", async () => {
    initializeTicketDraft(7, "Title", "Body", buildIssueMetadataFixture(), "t1");
    const created: Array<{ subject: string; parentId?: number }> = [];
    let nextId = 500;

    const result = await syncTicketDraft({
      ticketId: 7,
      content: buildTicketEditorMetadataContentWithChildren(
        "Title",
        "Body",
        ["Child task 1", "Child task 2"],
      ),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 7, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async (input) => {
          created.push(input as { subject: string; parentId?: number });
          return nextId++;
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(created.length, 2);
    assert.strictEqual(created[0].parentId, 7);
    const draft = getTicketDraft(7);
    assert.deepStrictEqual(draft?.baseMetadata.children, []);
  });

  test("skips duplicate children within the same update", async () => {
    initializeTicketDraft(8, "Title", "Body", buildIssueMetadataFixture(), "t1");
    const created: Array<{ subject: string }> = [];

    const result = await syncTicketDraft({
      ticketId: 8,
      content: buildTicketEditorMetadataContentWithChildren(
        "Title",
        "Body",
        ["Child task 1", "Child task 1"],
      ),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 8, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async (input) => {
          created.push(input as { subject: string });
          return 600;
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(created.length, 1);
    assert.match(result.message, /Skipped duplicate children/);
  });

  test("fails and rolls back when child creation fails during update", async () => {
    initializeTicketDraft(9, "Title", "Body", buildIssueMetadataFixture(), "t1");
    const deleted: number[] = [];
    let nextId = 700;

    const result = await syncTicketDraft({
      ticketId: 9,
      content: buildTicketEditorMetadataContentWithChildren(
        "Title",
        "Body",
        ["Child task 1", "Child task 2"],
      ),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 9, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async (input) => {
          if ((input as { subject: string }).subject === "Child task 2") {
            throw new Error("Child failure");
          }
          return nextId++;
        },
        deleteIssue: async (issueId: number) => {
          deleted.push(issueId);
        },
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.deepStrictEqual(deleted, [700]);
  });

  test("fails update when children metadata is invalid", async () => {
    initializeTicketDraft(10, "Title", "Body", buildIssueMetadataFixture(), "t1");
    const content = [
      "# Title",
      "",
      "---",
      "issue:",
      "  tracker:   Task",
      "  priority:  Normal",
      "  status:    In Progress",
      "  due_date:  2025-12-31",
      "  children: Child task 1",
      "---",
      "",
      "Body",
    ].join("\n");

    const result = await syncTicketDraft({
      ticketId: 10,
      content,
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => {
          throw new Error("should not create child");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
      },
    });

    assert.strictEqual(result.status, "failed");
  });

  test("updates without children do not create child tickets", async () => {
    initializeTicketDraft(11, "Title", "Body", buildIssueMetadataFixture(), "t1");
    let created = 0;

    const result = await syncTicketDraft({
      ticketId: 11,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Updated",
        metadata: buildIssueMetadataFixture(),
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 11, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => {
          created += 1;
          return 800;
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(created, 0);
  });

  test("reload overwrites editor content with saved data", async () => {
    initializeTicketDraft(5, "Title", "Body", buildIssueMetadataFixture(), "t1");
    setTicketDraftContent(5, {
      subject: "Draft",
      description: "Draft Body",
      metadata: buildIssueMetadataFixture(),
    });
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-5.md"), "Draft");
    let applied = "";

    const result = await reloadTicketEditor({
      ticketId: 5,
      editor,
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 5,
            subject: "Reloaded",
            description: "New Body",
            projectId: 1,
            updatedAt: "t2",
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "In Progress",
            dueDate: "2025-12-31",
          },
          comments: [],
        }),
        applyEditorContent: async (_editor, content) => {
          applied = content;
        },
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(
      applied,
      buildTicketEditorContent({
        subject: "Reloaded",
        description: "New Body",
        metadata: buildIssueMetadataFixture(),
      }),
    );
    const draft = getTicketDraft(5);
    assert.strictEqual(draft?.baseSubject, "Reloaded");
    assert.strictEqual(draft?.draftSubject, undefined);
  });

  test("reload keeps draft when fetch fails", async () => {
    initializeTicketDraft(6, "Title", "Body", buildIssueMetadataFixture(), "t1");
    setTicketDraftContent(6, {
      subject: "Draft",
      description: "Draft Body",
      metadata: buildIssueMetadataFixture(),
    });
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-6.md"), "Draft");

    const result = await reloadTicketEditor({
      ticketId: 6,
      editor,
      deps: {
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
        applyEditorContent: async () => undefined,
      },
    });

    assert.strictEqual(result.status, "unreachable");
    const draft = getTicketDraft(6);
    assert.strictEqual(draft?.draftSubject, "Draft");
  });
});
