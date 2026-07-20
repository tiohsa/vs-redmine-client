import * as assert from "assert";
import * as vscode from "vscode";
import { syncEditorToRedmine } from "../commands/syncToRedmine";
import {
  clearRegistry,
  getConnectionScopeForDocument,
  registerTicketDocument,
  registerTicketEditor,
} from "../views/ticketEditorRegistry";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeDraftStore,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createEditorStub } from "./helpers/editorStubs";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { createInMemoryDraftStorage } from "../views/draftPersistence";

suite("syncEditorToRedmine — draft status management", () => {
  setup(() => {
    initializeDraftStore(createInMemoryDraftStorage(), getCurrentConnectionScope());
  });

  teardown(() => {
    clearRegistry();
    clearTicketDrafts();
  });

  test("no_change: ドラフトステータスが Synced になる（ローディングアイコン永続化バグの回帰テスト）", async () => {
    const ticketId = 101;
    const metadata = buildIssueMetadataFixture();
    const content = buildTicketEditorContent({
      subject: "Title",
      description: "Body",
      metadata,
    });
    const editor = createEditorStub(vscode.Uri.parse("test://ticket-101"), content);
    registerTicketEditor(ticketId, editor, "primary", "ticket");
    initializeTicketDraft(ticketId, "Title", "Body", metadata, "t1");

    await syncEditorToRedmine(editor, { deps: {} });

    assert.strictEqual(
      getTicketDraft(ticketId)?.status,
      "Synced",
      "no_change のとき Syncing のままでなく Synced になるべき",
    );
  });

  test("API エラー時: ドラフトステータスが Failed になる", async () => {
    const ticketId = 102;
    const metadata = buildIssueMetadataFixture();
    const content = buildTicketEditorContent({
      subject: "Title",
      description: "Updated body",
      metadata,
    });
    const editor = createEditorStub(vscode.Uri.parse("test://ticket-102"), content);
    registerTicketEditor(ticketId, editor, "primary", "ticket");
    initializeTicketDraft(ticketId, "Title", "Original body", metadata, "t1");

    await syncEditorToRedmine(editor, {
      deps: {
        getIssueDetail: async () => {
          throw new Error("Request failed (500): Internal Server Error");
        },
      },
    });

    assert.strictEqual(getTicketDraft(ticketId)?.status, "Failed");
  });

  test("別接続先所有のエディターは同期せず未保存内容を保持する", async () => {
    const ticketId = 103;
    const metadata = buildIssueMetadataFixture();
    const content = buildTicketEditorContent({
      subject: "Unsaved",
      description: "Keep this body",
      metadata,
    });
    const editor = createEditorStub(vscode.Uri.parse("test://ticket-103"), content);
    const currentScope = getCurrentConnectionScope();
    const otherScope = currentScope === "https://other.example/redmine/"
      ? "https://another.example/redmine/"
      : "https://other.example/redmine/";
    registerTicketEditor(ticketId, editor, "primary", "ticket", undefined, otherScope);
    initializeTicketDraft(ticketId, "Unsaved", "Keep this body", metadata, "t1");
    let apiCalled = false;

    const result = await syncEditorToRedmine(editor, {
      deps: {
        getIssueDetail: async () => {
          apiCalled = true;
          throw new Error("must not be called");
        },
      },
    });

    assert.strictEqual(result, undefined);
    assert.strictEqual(apiCalled, false);
    assert.strictEqual(editor.document.getText(), content);
    assert.strictEqual(getTicketDraft(ticketId)?.baseDescription, "Keep this body");
  });

  test("新規コメント作成の非同期完了後も開始時スコープで登録する", async () => {
    const ticketId = 104;
    const currentScope = getCurrentConnectionScope();
    const content = "New comment";
    const editor = createEditorStub(vscode.Uri.parse("test://comment-draft-104"), content);
    registerTicketDocument(ticketId, editor.document, "commentDraft", undefined, currentScope);

    const result = await syncEditorToRedmine(editor, {
      deps: {
        addComment: async () => undefined,
        getCurrentUserId: async () => 9,
        getIssueDetail: async () => {
          await Promise.resolve();
          return {
            ticket: { id: ticketId, subject: "Ticket", projectId: 7 },
            comments: [{
              id: 501,
              ticketId,
              authorId: 9,
              authorName: "Tester",
              body: content,
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            }],
          };
        },
      },
    });

    assert.strictEqual(result?.kind, "comment");
    assert.strictEqual(result?.result.status, "created");
    assert.strictEqual(getConnectionScopeForDocument(editor.document), currentScope);
  });
});
