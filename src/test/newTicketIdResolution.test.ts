import * as assert from "assert";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  getOfflineSyncQueue,
  clearOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { queueNewTicketDraft, queueNewTicketDraftContent } from "../views/ticketSaveSync";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createEditorStub } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { buildTicketEditorContent } from "../views/ticketEditorContent";

const newTicketContent = () =>
  buildTicketEditorContent({
    subject: "New ticket subject",
    description: "Description",
    metadata: buildIssueMetadataFixture(),
  });

suite("新規チケット ID 反映", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento());
  });

  teardown(() => {
    clearOfflineSyncQueue();
  });

  test("queueNewTicketDraft: キューに追加され queued を返す", async () => {
    const uri = vscode.Uri.file("/tmp/new_ticket.md");
    const editor = createEditorStub(uri, newTicketContent());

    const result = await queueNewTicketDraft({ editor });

    assert.strictEqual(result.status, "queued");
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1);
    assert.strictEqual(q.newTickets[0].documentUri, uri.toString());
  });

  test("queueNewTicketDraftContent: URI なしでもキューに追加される", async () => {
    const result = await queueNewTicketDraftContent({
      content: newTicketContent(),
    });

    assert.strictEqual(result.status, "queued");
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1);
  });

  test("queueNewTicketDraft: 同じ URI で 2 度呼ぶと重複しない", async () => {
    const uri = vscode.Uri.file("/tmp/new_ticket_dup.md");
    const editor = createEditorStub(uri, newTicketContent());

    await queueNewTicketDraft({ editor });
    await queueNewTicketDraft({ editor });

    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 1);
  });

  test("queueNewTicketDraftContent: subject なしコンテンツは failed を返す", async () => {
    const contentNoSubject = buildTicketEditorContent({
      subject: "",
      description: "Description",
      metadata: buildIssueMetadataFixture(),
    });

    const result = await queueNewTicketDraftContent({ content: contentNoSubject });

    assert.strictEqual(result.status, "failed");
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("queueNewTicketDraft: subject なしは failed を返す", async () => {
    const uri = vscode.Uri.file("/tmp/new_ticket_empty.md");
    const contentNoSubject = buildTicketEditorContent({
      subject: "",
      description: "Description",
      metadata: buildIssueMetadataFixture(),
    });
    const editor = createEditorStub(uri, contentNoSubject);

    const result = await queueNewTicketDraft({ editor });

    assert.strictEqual(result.status, "failed");
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets.length, 0);
  });

  test("queueNewTicketDraftContent: projectId が指定された場合キューに保存される", async () => {
    const result = await queueNewTicketDraftContent({
      content: newTicketContent(),
      projectId: 42,
    });

    assert.strictEqual(result.status, "queued");
    const q = getOfflineSyncQueue();
    assert.strictEqual(q.newTickets[0].projectId, 42);
  });
});
