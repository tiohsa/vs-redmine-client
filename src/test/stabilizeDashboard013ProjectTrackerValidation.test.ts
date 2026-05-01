import * as assert from "assert";
import * as vscode from "vscode";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { initializeTicketDraft, clearTicketDrafts } from "../views/ticketDraftStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { syncTicketDraft, syncNewTicketDraftContent } from "../views/ticketSaveSync";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("0.1.3 安定化: プロジェクト固有トラッカー検証", () => {
  teardown(() => {
    clearTicketDrafts();
    clearNewTicketDrafts();
  });

  test("プロジェクト固有トラッカーが提供される場合、有効なトラッカーは受け入れられる", async () => {
    const baseMetadata = buildIssueMetadataFixture({ tracker: "Bug" });
    initializeTicketDraft(30, "Title", "Body", buildIssueMetadataFixture({ tracker: "Task" }), "t1");

    const result = await syncTicketDraft({
      ticketId: 30,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Body updated",
        metadata: baseMetadata,
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 30, subject: "Title", projectId: 5, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => undefined,
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 1, name: "Task" }, { id: 2, name: "Bug" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        searchUsers: async () => [],
        uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
        // プロジェクト A のトラッカー: Bug, Task
        getProjectTrackers: async (projectId) => {
          assert.strictEqual(projectId, 5);
          return [{ id: 1, name: "Task" }, { id: 2, name: "Bug" }];
        },
      },
    });

    assert.strictEqual(result.status, "success");
  });

  test("プロジェクト固有トラッカーが提供される場合、無効なトラッカーはエラーになる", async () => {
    const baseMetadata = buildIssueMetadataFixture({ tracker: "Bug" });
    initializeTicketDraft(31, "Title", "Body", buildIssueMetadataFixture({ tracker: "Task" }), "t1");

    const result = await syncTicketDraft({
      ticketId: 31,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Body updated",
        metadata: baseMetadata,
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 31, subject: "Title", projectId: 6, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => undefined,
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 1, name: "Task" }, { id: 2, name: "Bug" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        searchUsers: async () => [],
        uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
        // プロジェクト B のトラッカー: Task のみ（Bug は無効）
        getProjectTrackers: async () => [{ id: 1, name: "Task" }],
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.ok(
      result.message.includes("Bug"),
      `エラーメッセージにトラッカー名が含まれること: ${result.message}`,
    );
  });

  test("getProjectTrackers が未提供の場合はグローバルトラッカーで解決する", async () => {
    const baseMetadata = buildIssueMetadataFixture({ tracker: "Task" });
    initializeTicketDraft(32, "Title", "Body", buildIssueMetadataFixture(), "t1");

    const result = await syncTicketDraft({
      ticketId: 32,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Body updated",
        metadata: baseMetadata,
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 32, subject: "Title", projectId: 7, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => undefined,
        createIssue: async () => undefined,
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        searchUsers: async () => [],
        uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
        // getProjectTrackers 未提供 → グローバルトラッカーにフォールバック
      },
    });

    assert.strictEqual(result.status, "success");
  });

  test("syncNewTicketDraftContent: プロジェクト固有トラッカーが無効な場合はエラーになる", async () => {
    const content = buildTicketEditorContent({
      subject: "New Issue",
      description: "Description",
      metadata: buildIssueMetadataFixture({ tracker: "Bug" }),
      controlFields: { mode: "new-ticket", project_id: 10 },
    });

    const result = await syncNewTicketDraftContent({
      content,
      projectId: 10,
      documentUri: vscode.Uri.parse("file:///tmp/new-ticket.md"),
      deps: {
        createIssue: async () => 100,
        deleteIssue: async () => undefined,
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 1, name: "Task" }, { id: 2, name: "Bug" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        searchUsers: async () => [],
        uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
        // プロジェクト 10 は Task のみ（Bug は無効）
        getProjectTrackers: async () => [{ id: 1, name: "Task" }],
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.ok(result.message.includes("Bug"), `エラーメッセージにトラッカー名が含まれること: ${result.message}`);
  });
});
