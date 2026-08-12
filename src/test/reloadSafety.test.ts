import * as assert from "assert";
import * as vscode from "vscode";
import { initializeCommentEdit, clearCommentEdits } from "../views/commentEditStore";
import { initializeDraftStore, initializeTicketDraft, clearTicketDrafts } from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createEditorStub } from "./helpers/editorStubs";
import {
  confirmReloadDiscard,
  hasLocalCommentChanges,
  hasLocalTicketChanges,
} from "../views/reloadSafety";

suite("Reload safety", () => {
  const scope = "https://reload.example/redmine/";
  const metadata = buildIssueMetadataFixture();

  teardown(() => {
    clearTicketDrafts(scope);
    clearCommentEdits();
    initializeDraftStore(createInMemoryDraftStorage());
  });

  test("同期済みチケットは確認対象にしない", () => {
    initializeDraftStore(createInMemoryDraftStorage(), scope);
    initializeTicketDraft(1, "Saved", "Body", metadata, undefined, scope);
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-1.md"), buildTicketEditorContent({
      subject: "Saved",
      description: "Body",
      metadata,
    }));

    assert.strictEqual(hasLocalTicketChanges(1, editor, scope), false);
  });

  test("変更済みまたは解析不能なチケットは確認対象にする", () => {
    initializeDraftStore(createInMemoryDraftStorage(), scope);
    initializeTicketDraft(2, "Saved", "Body", metadata, undefined, scope);
    const changed = createEditorStub(vscode.Uri.parse("untitled:ticket-2.md"), buildTicketEditorContent({
      subject: "Changed",
      description: "Body",
      metadata,
    }));
    const invalid = createEditorStub(vscode.Uri.parse("untitled:ticket-3.md"), "not a ticket");

    assert.strictEqual(hasLocalTicketChanges(2, changed, scope), true);
    assert.strictEqual(hasLocalTicketChanges(2, invalid, scope), true);
  });

  test("コメントの本文差分を検出する", () => {
    initializeCommentEdit(10, 1, "Saved", undefined, scope);
    const saved = createEditorStub(vscode.Uri.parse("untitled:comment-10.md"), "Saved");
    const changed = createEditorStub(vscode.Uri.parse("untitled:comment-10.md"), "Changed");

    assert.strictEqual(hasLocalCommentChanges(10, saved, scope), false);
    assert.strictEqual(hasLocalCommentChanges(10, changed, scope), true);
  });

  test("明示的な破棄選択時だけ再読込を許可する", async () => {
    const accepted = await confirmReloadDiscard("Discard?", "Discard", async () => "Discard");
    const cancelled = await confirmReloadDiscard("Discard?", "Discard", async () => undefined);

    assert.strictEqual(accepted, true);
    assert.strictEqual(cancelled, false);
  });
});
