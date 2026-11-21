import * as assert from "assert";
import * as vscode from "vscode";
import {
  resolveActiveCommentForEditor,
  resolveActiveTicketForEditor,
} from "../app/editorEventController";
import { getConnectionScope } from "../config/connectionScope";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardTicketNode } from "../dashboard/dashboardProtocol";
import type { Ticket } from "../redmine/types";
import {
  clearRegistry,
  NEW_TICKET_DRAFT_ID,
  registerCommentDocument,
  registerNewTicketDraft,
  registerTicketDocument,
} from "../views/ticketEditorRegistry";
import { createEditorStub } from "./helpers/editorStubs";

const makeController = (store: DashboardStateStore): DashboardController => {
  const controller = new DashboardController({
    store,
    notifyOperationStarted: () => {},
    notifySuccess: () => {},
    notifyError: () => {},
    notifyToast: () => {},
    onTicketsRefreshed: () => {},
  });
  controller["commentService"].loadComments = async () => {};
  controller["metadataService"].loadEditOptions = async () => {};
  return controller;
};

const makeTicket = (id: number, projectId = 1): Ticket => ({
  id,
  subject: `Ticket #${id}`,
  description: "Description",
  projectId,
  updatedAt: "2026-11-21T00:00:00Z",
});

const makeNode = (id: number, children: DashboardTicketNode[] = [], level = 0): DashboardTicketNode => ({
  id,
  subject: `Ticket #${id}`,
  syncState: "Synced",
  children,
  level,
});

suite("editor active ticket follow", () => {
  teardown(() => {
    clearRegistry();
  });

  test("resolveActiveTicketForEditor: 既存チケット・コメント・下書き・一般ファイルを判別する", () => {
    const scope = "https://redmine.example.com";

    const ticketEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-ticket-10.md"),
      "# #10",
    );
    registerTicketDocument(10, ticketEditor.document, "ticket", 1, scope);
    assert.deepStrictEqual(resolveActiveTicketForEditor(ticketEditor), {
      ticketId: 10,
      connectionScope: scope,
    });

    const commentEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-comment-10.md"),
      "comment body",
    );
    registerCommentDocument(10, 55, commentEditor.document, 1, scope);
    assert.deepStrictEqual(resolveActiveTicketForEditor(commentEditor), {
      ticketId: 10,
      connectionScope: scope,
    });

    const commentDraftEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-comment-draft-20.md"),
      "draft body",
    );
    registerTicketDocument(20, commentDraftEditor.document, "commentDraft", 1, scope);
    assert.deepStrictEqual(resolveActiveTicketForEditor(commentDraftEditor), {
      ticketId: 20,
      connectionScope: scope,
    });

    const newDraftEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
      "# new",
    );
    registerNewTicketDraft(newDraftEditor);
    assert.strictEqual(resolveActiveTicketForEditor(newDraftEditor), undefined);

    const plainEditor = createEditorStub(vscode.Uri.parse("file:///workspace/app.ts"), "const x = 1;");
    assert.strictEqual(resolveActiveTicketForEditor(plainEditor), undefined);
    assert.strictEqual(resolveActiveTicketForEditor(undefined), undefined);
  });

  test("DashboardController.selectTicketForEditor: 設定・スコープ・一覧可視性に応じて選択を制御する", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const prevFollow = config.inspect<unknown>("ticketList.followActiveEditor")?.globalValue;
    const prevBaseUrl = config.inspect<unknown>("baseUrl")?.globalValue;

    try {
      await config.update("baseUrl", "https://redmine.example.com", vscode.ConfigurationTarget.Global);
      const currentScope = getConnectionScope("https://redmine.example.com");

      const store = new DashboardStateStore();
      const controller = makeController(store);
      controller["cache"].tickets = [makeTicket(10), makeTicket(11), makeTicket(99)];
      store.update({
        tickets: [makeNode(10, [makeNode(11, [], 1)], 0)],
      });

      await config.update("ticketList.followActiveEditor", false, vscode.ConfigurationTarget.Global);
      await controller.selectTicketForEditor(10, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await config.update("ticketList.followActiveEditor", true, vscode.ConfigurationTarget.Global);

      await controller.selectTicketForEditor(NEW_TICKET_DRAFT_ID, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.selectTicketForEditor(10, "https://other-redmine.example.com");
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.selectTicketForEditor(99, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.selectTicketForEditor(11, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, 11);
      assert.strictEqual(store.getState().selectedTicket?.id, 11);

      let selectCalls = 0;
      const originalSelectTicket = controller["ticketService"].selectTicket.bind(controller["ticketService"]);
      controller["ticketService"].selectTicket = async (id, throwOnError) => {
        selectCalls++;
        await originalSelectTicket(id, throwOnError);
      };
      await controller.selectTicketForEditor(11, currentScope);
      assert.strictEqual(selectCalls, 0);

      controller.dispose();
    } finally {
      await config.update("ticketList.followActiveEditor", prevFollow, vscode.ConfigurationTarget.Global);
      await config.update("baseUrl", prevBaseUrl, vscode.ConfigurationTarget.Global);
    }
  });

  test("resolveActiveCommentForEditor: コメントと下書きを識別しチケットや一般ファイルは undefined を返す", () => {
    const scope = "https://redmine.example.com";

    const commentEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-comment-10.md"),
      "comment body",
    );
    registerCommentDocument(10, 55, commentEditor.document, 1, scope);
    assert.deepStrictEqual(resolveActiveCommentForEditor(commentEditor), {
      ticketId: 10,
      commentId: 55,
      documentUri: "untitled:redmine-client-comment-10.md",
      connectionScope: scope,
    });

    const commentDraftEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-comment-draft-20.md"),
      "draft body",
    );
    registerTicketDocument(20, commentDraftEditor.document, "commentDraft", 1, scope);
    assert.deepStrictEqual(resolveActiveCommentForEditor(commentDraftEditor), {
      ticketId: 20,
      documentUri: "untitled:redmine-client-comment-draft-20.md",
      connectionScope: scope,
    });

    const ticketEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-ticket-10.md"),
      "# #10",
    );
    registerTicketDocument(10, ticketEditor.document, "ticket", 1, scope);
    assert.strictEqual(resolveActiveCommentForEditor(ticketEditor), undefined);

    const newDraftEditor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
      "# new",
    );
    registerNewTicketDraft(newDraftEditor);
    assert.strictEqual(resolveActiveCommentForEditor(newDraftEditor), undefined);

    const plainEditor = createEditorStub(vscode.Uri.parse("file:///workspace/app.ts"), "const x = 1;");
    assert.strictEqual(resolveActiveCommentForEditor(plainEditor), undefined);
    assert.strictEqual(resolveActiveCommentForEditor(undefined), undefined);
  });

  test("DashboardController.selectCommentForEditor: 設定・スコープ・可視性に応じ、同一チケット時は再読込せず選択だけ切り替える", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const prevFollow = config.inspect<unknown>("ticketList.followActiveEditor")?.globalValue;
    const prevBaseUrl = config.inspect<unknown>("baseUrl")?.globalValue;

    try {
      await config.update("baseUrl", "https://redmine.example.com", vscode.ConfigurationTarget.Global);
      const currentScope = getConnectionScope("https://redmine.example.com");

      const store = new DashboardStateStore();
      const controller = new DashboardController({
        store,
        notifyOperationStarted: () => {},
        notifySuccess: () => {},
        notifyError: () => {},
        notifyToast: () => {},
        onTicketsRefreshed: () => {},
      });
      let loadCommentsCalls = 0;
      controller["commentService"].loadComments = async (ticketId, _throwOnError, selection) => {
        loadCommentsCalls++;
        store.updateNested("comments", {
          ticketId,
          loading: false,
          selectedCommentId: selection?.commentId,
          selectedCommentUri: selection?.commentId !== undefined ? undefined : selection?.documentUri,
        });
      };
      controller["metadataService"].loadEditOptions = async () => {};
      controller["cache"].tickets = [makeTicket(10), makeTicket(11), makeTicket(99)];
      store.update({
        tickets: [makeNode(10, [makeNode(11, [], 1)], 0)],
      });

      await config.update("ticketList.followActiveEditor", false, vscode.ConfigurationTarget.Global);
      await controller.selectCommentForEditor({ ticketId: 10, commentId: 55 }, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, undefined);
      assert.strictEqual(store.getState().comments.selectedCommentId, undefined);

      await config.update("ticketList.followActiveEditor", true, vscode.ConfigurationTarget.Global);

      await controller.selectCommentForEditor({ ticketId: 10, commentId: 55 }, "https://other-redmine.example.com");
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.selectCommentForEditor({ ticketId: 99, commentId: 55 }, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.selectCommentForEditor({ ticketId: 11, commentId: 55, documentUri: "untitled:c55.md" }, currentScope);
      assert.strictEqual(store.getState().selectedTicketId, 11);
      assert.strictEqual(store.getState().comments.selectedCommentId, 55);
      assert.strictEqual(store.getState().comments.selectedCommentUri, undefined);
      assert.strictEqual(loadCommentsCalls, 1);

      await controller.selectCommentForEditor({ ticketId: 11, commentId: 56, documentUri: "untitled:c56.md" }, currentScope);
      assert.strictEqual(store.getState().comments.selectedCommentId, 56);
      assert.strictEqual(loadCommentsCalls, 1, "同一チケット内の別コメントでは再読込しないこと");

      await controller.selectCommentForEditor({ ticketId: 11, documentUri: "untitled:draft.md" }, currentScope);
      assert.strictEqual(store.getState().comments.selectedCommentId, undefined);
      assert.strictEqual(store.getState().comments.selectedCommentUri, "untitled:draft.md");
      assert.strictEqual(loadCommentsCalls, 1);

      controller.dispose();
    } finally {
      await config.update("ticketList.followActiveEditor", prevFollow, vscode.ConfigurationTarget.Global);
      await config.update("baseUrl", prevBaseUrl, vscode.ConfigurationTarget.Global);
    }
  });
});
