import * as assert from "assert";
import * as vscode from "vscode";
import {
  clearRegistry,
  getCommentIdForDraftUri,
  getLastActiveEditor,
  getNewTicketDraftUri,
  getNewCommentDraftUri,
  getPrimaryEditor,
  getTicketIdForDraftUri,
  getTicketEditors,
  getTicketIdForEditor,
  getTicketIdForDocument,
  getTicketIdForUri,
  getEditorContentType,
  getEditorContentTypeForDocument,
  getEditorContentTypeForUri,
  getProjectIdForDocument,
  getProjectIdForUri,
  markEditorActive,
  NEW_TICKET_DRAFT_ID,
  registerCommentDocument,
  registerTicketDocument,
  registerNewCommentDraft,
  registerNewTicketDraft,
  registerTicketEditor,
  refreshEditorConnectionScopes,
  resolveEditorConnectionScope,
  getConnectionScopeForDocument,
  removeTicketEditorByDocument,
  removeTicketEditorByUri,
} from "../views/ticketEditorRegistry";
import { getConnectionScopeHash } from "../config/connectionScope";
import { createDocumentStub, createEditorStub } from "./helpers/editorStubs";

suite("Ticket editor registry", () => {
  teardown(() => {
    clearRegistry();
  });

  test("tracks primary and extra editors", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-1"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-1-extra"), "");

    registerTicketEditor(1, primary, "primary", "ticket");
    registerTicketEditor(1, extra, "extra", "ticket");

    const editors = getTicketEditors(1);
    assert.strictEqual(editors.length, 2);
    assert.ok(editors.some((record) => record.kind === "primary"));
    assert.ok(editors.some((record) => record.kind === "extra"));
  });

  test("resolves last active editor", async () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-2"), "");
    const extra = createEditorStub(vscode.Uri.parse("untitled:ticket-2-extra"), "");

    registerTicketEditor(2, primary, "primary", "ticket");
    registerTicketEditor(2, extra, "extra", "ticket");

    markEditorActive(primary);
    await new Promise((resolve) => setTimeout(resolve, 5));
    markEditorActive(extra);

    const lastActive = getLastActiveEditor(2);
    assert.ok(lastActive);
    assert.strictEqual(lastActive?.uri, extra.document.uri.toString());
  });

  test("removes closed editors", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-3"), "");
    registerTicketEditor(3, primary, "primary", "ticket");

    removeTicketEditorByDocument(primary.document);

    assert.strictEqual(getPrimaryEditor(3), undefined);
    assert.strictEqual(getTicketEditors(3).length, 0);
  });

  test("keeps record when document uri changes", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-4"), "");
    registerTicketEditor(4, primary, "primary", "ticket");

    (primary.document as { uri: vscode.Uri }).uri = vscode.Uri.parse("file:/tmp/ticket-4.md");

    assert.strictEqual(getTicketIdForEditor(primary), 4);
  });

  test("resolves ticket and project from document", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-5"), "");
    registerTicketEditor(5, primary, "primary", "ticket", 20);

    assert.strictEqual(getTicketIdForDocument(primary.document), 5);
    assert.strictEqual(getProjectIdForDocument(primary.document), 20);
  });

  test("prefers non-draft record when editor mapping is stale", () => {
    const editor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-ticket.md"),
      "",
    );

    registerNewTicketDraft(editor);
    registerTicketDocument(42, editor.document, "ticket", 9);

    assert.strictEqual(getTicketIdForEditor(editor), 42);
  });

  test("prefers comment draft record when editor mapping differs", () => {
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-8"), "");

    registerTicketEditor(8, editor, "primary", "ticket");
    registerTicketDocument(8, editor.document, "commentDraft");

    assert.strictEqual(getEditorContentType(editor), "commentDraft");
  });

  test("resolves content type from document and uri", () => {
    const editor = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-comment-11.md"),
      "",
    );

    registerNewCommentDraft(11, editor);

    assert.strictEqual(getEditorContentTypeForDocument(editor.document), "commentDraft");
    assert.strictEqual(
      getEditorContentTypeForUri(editor.document.uri),
      "commentDraft",
    );
  });

  test("resolves ticket and project from uri", () => {
    const primary = createEditorStub(vscode.Uri.parse("untitled:ticket-6"), "");
    registerTicketEditor(6, primary, "primary", "ticket", 30);

    assert.strictEqual(getTicketIdForUri(primary.document.uri), 6);
    assert.strictEqual(getProjectIdForUri(primary.document.uri), 30);
  });

  test("registers ticket by document without editor reference", () => {
    const document = createDocumentStub(vscode.Uri.parse("untitled:ticket-7"), "");

    registerTicketDocument(7, document, "ticket", 40);

    assert.strictEqual(getTicketIdForDocument(document), 7);
    assert.strictEqual(getProjectIdForDocument(document), 40);
  });

  test("returns the new ticket draft uri when registered", () => {
    const draft = createEditorStub(vscode.Uri.parse("untitled:redmine-client-new-ticket.md"), "");

    registerNewTicketDraft(draft);

    const uri = getNewTicketDraftUri();
    assert.strictEqual(uri?.toString(), "untitled:redmine-client-new-ticket.md");
  });

  test("returns the new comment draft uri when registered", () => {
    const draft = createEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-comment-9.md"),
      "",
    );

    registerNewCommentDraft(9, draft);

    const uri = getNewCommentDraftUri(9);
    assert.strictEqual(uri?.toString(), "untitled:redmine-client-new-comment-9.md");
  });

  test("matches comment draft uri when scheme changes on Windows path", () => {
    const document = createDocumentStub(
      vscode.Uri.parse("untitled:C:\\tmp\\redmine-client-new-comment-9.md"),
      "",
    );
    registerCommentDocument(9, 77, document);

    const resolved = getCommentIdForDraftUri(
      9,
      "file:///C:/tmp/redmine-client-new-comment-9.md",
    );
    assert.strictEqual(resolved, 77);
  });

  test("matches comment draft uri when current uri uses Windows backslashes", () => {
    const document = createDocumentStub(
      vscode.Uri.parse("file:///C:/tmp/redmine-client-new-comment-12.md"),
      "",
    );
    registerCommentDocument(12, 88, document);

    const resolved = getCommentIdForDraftUri(
      12,
      "untitled:C:\\tmp\\redmine-client-new-comment-12.md",
    );
    assert.strictEqual(resolved, 88);
  });

  test("matches ticket draft uri when scheme changes on Windows path", () => {
    const draft = createEditorStub(
      vscode.Uri.parse("untitled:C:\\tmp\\redmine-client-new-ticket.md"),
      "",
    );
    registerNewTicketDraft(draft);

    const resolved = getTicketIdForDraftUri(
      "file:///C:/tmp/redmine-client-new-ticket.md",
    );
    assert.strictEqual(resolved, NEW_TICKET_DRAFT_ID);
  });

  test("matches ticket draft uri when current uri uses Windows backslashes", () => {
    const draft = createEditorStub(
      vscode.Uri.parse("file:///C:/tmp/redmine-client-new-ticket.md"),
      "",
    );
    registerNewTicketDraft(draft);

    const resolved = getTicketIdForDraftUri(
      "untitled:C:\\tmp\\redmine-client-new-ticket.md",
    );
    assert.strictEqual(resolved, NEW_TICKET_DRAFT_ID);
  });

  test("同一ticket IDのエディターを接続スコープごとに分離する", () => {
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    const editorA = createEditorStub(vscode.Uri.parse("file:/a/ticket-1.md"), "A");
    const editorB = createEditorStub(vscode.Uri.parse("file:/b/ticket-1.md"), "B");
    registerTicketEditor(1, editorA, "primary", "ticket", undefined, scopeA);
    registerTicketEditor(1, editorB, "primary", "ticket", undefined, scopeB);

    assert.deepStrictEqual(getTicketEditors(1, scopeA).map((record) => record.uri), [
      editorA.document.uri.toString(),
    ]);
    assert.deepStrictEqual(getTicketEditors(1, scopeB).map((record) => record.uri), [
      editorB.document.uri.toString(),
    ]);
  });

  test("旧形式ファイルは復元時の現在接続先へ移行する", () => {
    const scope = "https://current.example/redmine/";
    const document = createDocumentStub(
      vscode.Uri.parse("file:/workspace/project-1_ticket-1.md"),
      "",
    );

    assert.strictEqual(resolveEditorConnectionScope(document.uri, scope), scope);
    registerTicketDocument(1, document, "ticket", undefined, scope);
    assert.strictEqual(getConnectionScopeForDocument(document), scope);
  });

  test("再起動復元された別接続先ファイルは切り戻すまで所有スコープを付与しない", () => {
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    const hashA = getConnectionScopeHash(scopeA);
    const document = createDocumentStub(
      vscode.Uri.parse(`file:/workspace/.redmine-client/editors/${hashA}/ticket-1.md`),
      "",
    );

    const unresolvedScope = `unresolved:${hashA}`;
    assert.strictEqual(resolveEditorConnectionScope(document.uri, scopeB), unresolvedScope);
    registerTicketDocument(1, document, "ticket", undefined, unresolvedScope);
    refreshEditorConnectionScopes(scopeB);
    assert.strictEqual(getConnectionScopeForDocument(document), unresolvedScope);
    refreshEditorConnectionScopes(scopeA);
    assert.strictEqual(getConnectionScopeForDocument(document), scopeA);
  });

  test("設定済み保存先の接続ハッシュディレクトリを復元する", () => {
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    const hashA = getConnectionScopeHash(scopeA);
    const document = createDocumentStub(
      vscode.Uri.parse(`file:/custom/editor-store/${hashA}/project-1_ticket-1.md`),
      "",
    );

    assert.strictEqual(resolveEditorConnectionScope(document.uri, scopeA), scopeA);
    assert.strictEqual(
      resolveEditorConnectionScope(document.uri, scopeB),
      `unresolved:${hashA}`,
    );
  });
});
