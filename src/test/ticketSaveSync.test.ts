import * as assert from "assert";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
  markDraftStatus,
  setTicketDraftContent,
} from "../views/ticketDraftStore";
import {
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { applyQueuedTicketUpdate } from "../views/ticketSync/ticketQueueSync";
import { reloadTicketEditor, syncTicketDraft } from "../views/ticketSync/ticketUpdateSync";
import { forceSaveLocal, mergeTicketContent } from "../views/conflictResolver";
import { createTicketSyncService } from "../app/ticketSync";
import { createEditorStub, createMutableEditorStub } from "./helpers/editorStubs";
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

  test("refreshes remote fields when there is no local change", async () => {
    const metadata = {
      tracker: "Task",
      priority: "Normal",
      status: "New",
      due_date: "",
      children: [],
    };
    initializeTicketDraft(12, "Title", "Body", metadata, "t1");
    let content = buildTicketEditorContent({ subject: "Title", description: "Body", metadata });
    const editor = {
      document: { getText: () => content },
      edit: async (callback: (builder: { replace: (_range: unknown, value: string) => void }) => void) => {
        callback({ replace: (_range, value) => { content = value; } });
        return true;
      },
    } as unknown as vscode.TextEditor;

    const result = await syncTicketDraft({
      ticketId: 12,
      content,
      editor,
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 12,
            subject: "Title",
            description: "Body",
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "Closed",
            updatedAt: "t2",
          },
          comments: [],
        }),
        updateIssue: async () => { throw new Error("should not update"); },
        createIssue: async () => { throw new Error("should not create child"); },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "no_change");
    assert.strictEqual(getTicketDraft(12)?.baseMetadata.status, "Closed");
    assert.ok(content.includes("status:    Closed"));
  });

  test("queued no_change reconciles remote canonical state and clears dirty draft status", async () => {
    const metadata = buildIssueMetadataFixture();
    initializeTicketDraft(101, "Title", "Body", metadata, "t1");
    markDraftStatus(101, "Dirty");

    const result = await applyQueuedTicketUpdate({
      update: {
        ticketId: 101,
        baseSubject: "Title",
        baseDescription: "Body",
        baseMetadata: metadata,
        lastKnownRemoteUpdatedAt: "t1",
        subject: "Title",
        description: "Body",
        metadata,
      },
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 101,
            subject: "Title",
            description: "Body",
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "In Progress",
            dueDate: "2025-12-31",
            updatedAt: "t1",
          },
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
    assert.strictEqual(getTicketDraft(101)?.status, "Synced");
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

  test("merges local text with a remote-only status change", async () => {
    const baseMetadata = buildIssueMetadataFixture({ status: "New" });
    const localContent = buildTicketEditorContent({
      subject: "Title",
      description: "Local description",
      metadata: baseMetadata,
    });
    initializeTicketDraft(102, "Title", "Body", baseMetadata, "t1");
    await addOfflineTicketUpdateAsync(102, {
      ticketId: 102,
      baseSubject: "Title",
      baseDescription: "Body",
      baseMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Local description",
      metadata: baseMetadata,
    });

    const result = await syncTicketDraft({
      ticketId: 102,
      content: localContent,
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 102,
            subject: "Title",
            description: "Body",
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "Closed",
            dueDate: "2025-12-31",
            updatedAt: "t2",
          },
          comments: [],
        }),
        updateIssue: async () => { throw new Error("should not update"); },
        createIssue: async () => { throw new Error("should not create child"); },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "conflict");
    assert.strictEqual(result.conflictContext?.remoteMetadata.status, "Closed");
    const editor = createMutableEditorStub(vscode.Uri.parse("untitled:ticket-102.md"), localContent);
    const merged = await mergeTicketContent(result.conflictContext!, editor);

    assert.strictEqual(merged.status, "merged");
    assert.ok(editor.document.getText().includes("Local description"));
    assert.ok(editor.document.getText().includes("status:    Closed"));
    assert.strictEqual(getTicketDraft(102)?.baseMetadata.status, "Closed");
    assert.strictEqual(getOfflineSyncQueue().tickets.has(102), false);
  });

  test("local priority replaces the stale conflict snapshot before retrying sync", async () => {
    const scope = "test:local-priority-conflict";
    const ticketId = 103;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const localContent = buildTicketEditorContent({
      subject: "Created title",
      description: "Local edit after create",
      metadata,
    });
    initializeTicketDraft(
      ticketId,
      "Created title",
      "Created body",
      metadata,
      "t1",
      scope,
    );
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      baseSubject: "Created title",
      baseDescription: "Created body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Created title",
      description: "Local edit after create",
      content: localContent,
      metadata,
      documentUri: "untitled:ticket-103.md",
      connectionScope: scope,
      operationId: `${scope}:ticket:${ticketId}`,
      phase: "queued",
    }, scope);

    const conflict = await syncTicketDraft({
      operationScope: scope,
      ticketId,
      content: localContent,
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: ticketId,
            subject: "Server edit",
            description: "Created body",
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "New",
            updatedAt: "t2",
          },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("conflicting update must not be written");
        },
        createIssue: async () => {
          throw new Error("child ticket must not be created");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });
    assert.strictEqual(conflict.status, "conflict");
    assert.ok(conflict.conflictContext);

    let updateCalls = 0;
    let updated = false;
    let revisionAtRemoteWrite: number | undefined;
    let intentRevisionAtRemoteWrite: number | undefined;
    const syncService = createTicketSyncService({
      update: {
        getIssueDetail: async () => ({
          ticket: {
            id: ticketId,
            subject: updated ? "Created title" : "Server edit",
            description: updated ? "Local edit after create" : "Created body",
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "New",
            updatedAt: updated ? "t3" : "t2",
          },
          comments: [],
        }),
        updateIssue: async () => {
          updateCalls += 1;
          const queued = getOfflineSyncQueue(scope).tickets.get(ticketId);
          revisionAtRemoteWrite = queued?.revision;
          intentRevisionAtRemoteWrite = queued?.intentRevision;
          updated = true;
        },
        createIssue: async () => {
          throw new Error("child ticket must not be created");
        },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        searchUsers: async () => [],
        uploadFile: async () => ({
          token: "test-token",
          filename: "test.txt",
          contentType: "text/plain",
        }),
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
        listProjectMembers: async () => [],
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
      runInConnectionScope: async (_connectionScope, operation) => operation(),
    });

    try {
      const editor = createMutableEditorStub(
        vscode.Uri.parse("untitled:ticket-103.md"),
        localContent,
      );
      const resolved = await forceSaveLocal(
        conflict.conflictContext!,
        editor,
        scope,
        syncService,
      );

      assert.notStrictEqual(resolved.status, "conflict");
      assert.strictEqual(updateCalls, 1, resolved.message);
      assert.strictEqual(revisionAtRemoteWrite, 2);
      assert.strictEqual(intentRevisionAtRemoteWrite, 2);
    } finally {
      await clearOfflineSyncQueueAsync(scope);
    }
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

  test("uses remote fields after a successful update", async () => {
    const metadata = buildIssueMetadataFixture({ status: "In Progress" });
    initializeTicketDraft(13, "Title", "Body", metadata, "t1");
    let content = buildTicketEditorContent({ subject: "Changed", description: "Body", metadata });
    const editor = {
      document: { getText: () => content },
      edit: async (callback: (builder: { replace: (_range: unknown, value: string) => void }) => void) => {
        callback({ replace: (_range, value) => { content = value; } });
        return true;
      },
    } as unknown as vscode.TextEditor;
    let detailCall = 0;

    const result = await syncTicketDraft({
      ticketId: 13,
      content,
      editor,
      deps: {
        getIssueDetail: async () => {
          detailCall += 1;
          return {
            ticket: {
              id: 13,
              subject: detailCall === 1 ? "Title" : "Changed",
              description: "Body",
              projectId: 1,
              trackerName: "Task",
              priorityName: "Normal",
              statusName: detailCall === 1 ? "In Progress" : "Closed",
              updatedAt: detailCall === 1 ? "t1" : "t2",
            },
            comments: [],
          };
        },
        updateIssue: async () => undefined,
        createIssue: async () => { throw new Error("should not create child"); },
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(getTicketDraft(13)?.baseMetadata.status, "Closed");
    assert.ok(content.includes("status:    Closed"));
  });

  test("notifies list updater after a subject change", async () => {
    initializeTicketDraft(5, "Title", "Body", buildIssueMetadataFixture(), "t1");
    const updated: Array<{ id: number; subject: string }> = [];
    const updatedAtValues = ["t1", "t2"];

    const result = await syncTicketDraft({
      ticketId: 5,
      content: buildTicketEditorContent({
        subject: "New Title",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
      }),
      onSubjectUpdated: (ticketId, subject) => {
        updated.push({ id: ticketId, subject });
      },
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 5,
            subject: updatedAtValues[0] === "t1" ? "Title" : "New Title",
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
    assert.deepStrictEqual(updated, [{ id: 5, subject: "New Title" }]);
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
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
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
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
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
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
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
        metadata: buildIssueMetadataFixture({ start_date: "" }),
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
