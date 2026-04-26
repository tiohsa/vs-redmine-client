import * as assert from "assert";
import * as vscode from "vscode";
import { syncEditorToRedmine } from "../commands/syncToRedmine";
import { clearRegistry, registerTicketEditor } from "../views/ticketEditorRegistry";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createEditorStub } from "./helpers/editorStubs";

suite("syncEditorToRedmine — draft status management", () => {
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
});
