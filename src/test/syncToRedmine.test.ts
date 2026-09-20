import { clearCommentEdits, initializeCommentEdit } from "../views/commentEditStore";
import { initializeOfflineSyncStore, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { withConfiguration } from "./helpers/configuration";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
import { createEditorStub, createMutableEditorStub } from "./helpers/editorStubs";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { createInMemoryDraftStorage } from "../views/draftPersistence";

suite("syncEditorToRedmine — draft status management", () => {
  setup(() => {
    initializeDraftStore(createInMemoryDraftStorage(), getCurrentConnectionScope());
  });

  teardown(() => {
    clearRegistry();
    clearTicketDrafts();
    clearCommentEdits();
  });

  test("no_change: ドラフトステータスが Synced になる（ローディングアイコン永続化バグの回帰テスト）", async () => {
    const ticketId = 101;
    const metadata = buildIssueMetadataFixture();
    const content = buildTicketEditorContent({
      subject: "Title",
      description: "Body",
      metadata,
    });
    const editor = createMutableEditorStub(vscode.Uri.parse("test://ticket-101"), content);
    registerTicketEditor(ticketId, editor, "primary", "ticket");
    initializeTicketDraft(ticketId, "Title", "Body", metadata, "t1");

    await syncEditorToRedmine(editor, {
      rewrite: {
        textDocuments: [editor.document],
        textEditors: [editor],
        applyEdit: async () => true,
        saveDocument: async () => true,
      },
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: ticketId,
            projectId: 1,
            subject: "Title",
            description: "Body",
            trackerName: metadata.tracker,
            priorityName: metadata.priority,
            statusName: metadata.status,
            updatedAt: "t2",
          },
          comments: [],
        }),
      },
    });

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-draft-scope-"));
    const file = path.join(dir, `redmine-client-new-comment-${ticketId}.md`);
    fs.writeFileSync(file, content);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
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
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("手動 ticket 同期は注入された共有 SyncEngine の editor 経路を使う", async () => {
    const ticketId = 105;
    const metadata = buildIssueMetadataFixture();
    const editor = createMutableEditorStub(
      vscode.Uri.parse("test://ticket-105"),
      buildTicketEditorContent({
        subject: "Title",
        description: "Updated body",
        metadata,
      }),
    );
    registerTicketEditor(ticketId, editor, "primary", "ticket");
    initializeTicketDraft(ticketId, "Title", "Original body", metadata, "t1");
    let sharedEditorSyncCalls = 0;
    await withConfiguration("offlineSyncMode", "manual", async () => {
      const result = await syncEditorToRedmine(editor, {
        trigger: "explicit",
        syncEngine: {
          syncOne: async () => ({ kind: "no_change", ticketId }),
          syncTicketEditor: async (input) => {
            sharedEditorSyncCalls += 1;
            assert.strictEqual(input.editor, editor);
            assert.strictEqual(input.ticketId, ticketId);
            assert.strictEqual(input.manual, false, "明示同期では manual 設定でも queue-only にしないこと");
            return { kind: "completed", ticketId };
          },
        },
      });

      assert.strictEqual(sharedEditorSyncCalls, 1);
      assert.strictEqual(result?.kind, "ticket");
      assert.strictEqual(result?.result.status, "success");
    });
  });
  for (const contentType of ["ticket", "comment", "commentDraft"] as const) {
    test(`manual ${contentType}: save は queue-only、explicit は remote sync`, async () => {
      await withConfiguration("offlineSyncMode", "manual", async () => {
        const ticketId = 106;
        initializeOfflineSyncStore(createTestMemento(), getCurrentConnectionScope());
        const editor = createMutableEditorStub(vscode.Uri.parse(`test://manual/${contentType}`), "Updated body");
        const record = registerTicketEditor(ticketId, editor, "primary", contentType);
        if (contentType === "comment") {
          record.commentId = 10;
          initializeCommentEdit(10, ticketId, "Base body");
        }
        if (contentType === "ticket") {
          initializeTicketDraft(ticketId, "Title", "Original body", buildIssueMetadataFixture(), "t1");
        }
        let remoteSyncCalls = 0;
        const syncEngine = {
          syncOne: async () => { remoteSyncCalls++; return { kind: "completed" as const, ticketId, commentId: 10 }; },
          syncTicketEditor: async (input: { manual?: boolean }) => {
            if (input.manual) { return { kind: "queued" as const }; }
            remoteSyncCalls++;
            return { kind: "completed" as const, ticketId };
          },
        };
        const saved = await syncEditorToRedmine(editor, { trigger: "save", syncEngine });
        assert.strictEqual(saved?.result.status, "queued");
        assert.strictEqual(remoteSyncCalls, 0);
        if (contentType !== "ticket") {
          assert.strictEqual(getOfflineSyncQueue().comments.length, 1);
        }
        const synced = await syncEditorToRedmine(editor, { trigger: "explicit", syncEngine });
        assert.strictEqual(synced?.result.status, contentType === "commentDraft" ? "created" : "success");
        assert.strictEqual(remoteSyncCalls, 1);
      });
    });
  }

});
