import * as assert from "assert";
import * as vscode from "vscode";
import { addComment } from "../../redmine/comments";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { initializeTicketDraft } from "../../views/ticketDraftStore";
import { applyEditorContent } from "../../views/ticketPreview";
import { computeNotesHash } from "../../utils/notesHash";
import {
  applyRemoteContent, mergeTicketContent, forceSaveLocal, handleConflict,
  applyRemoteCommentContent, mergeCommentContent, forceCommentSaveLocal,
} from "../../views/conflictResolver";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { registerTicketEditor, setEditorCommentId } from "../../views/ticketEditorRegistry";
import { liveTest, type LiveFixture } from "./liveFixture";

const base = "first\nsecond\nthird";
const localBody = "local first\nsecond\nthird";
const remoteBody = "first\nsecond\nremote third";
const lf = (text: string | undefined) => text?.replace(/\r\n/g, "\n");

const ticketConflict = async (live: LiveFixture) => {
  const ticketId = await live.createIssue({ description: base });
  const detail = await live.readIssue(ticketId);
  const metadata = metadataFromTicket(detail.ticket);
  const content = buildTicketEditorContent({ subject: detail.ticket.subject, description: localBody, metadata });
  const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  initializeTicketDraft(ticketId, detail.ticket.subject, base, metadata, detail.ticket.updatedAt, live.scope);
  const key = await live.queueTicket(ticketId, {
    description: localBody, content: editor.document.getText(), lastKnownRemoteUpdatedAt: "2000-01-01T00:00:00Z",
  });
  await live.request({ method: "PUT", path: `/issues/${ticketId}.json`, body: { issue: { description: remoteBody } } });
  const outcome = await live.engine().syncOne(key, live.context);
  assert.strictEqual(outcome.kind, "conflict");
  if (outcome.kind !== "conflict" || !("conflictContext" in outcome) || !outcome.conflictContext) {
    throw new Error("チケットの競合情報がありません。");
  }
  return { key, ticketId, editor, context: outcome.conflictContext };
};

const commentConflict = async (live: LiveFixture) => {
  const ticketId = await live.createIssue();
  await live.run(() => addComment(ticketId, base));
  const original = (await live.readIssue(ticketId)).comments.find((comment) => comment.body === base);
  assert.ok(original);
  const commentId = original.id;
  const doc = await vscode.workspace.openTextDocument({ content: localBody, language: "markdown" });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  registerTicketEditor(ticketId, editor, "primary", "comment", live.projectId, live.scope);
  setEditorCommentId(editor, commentId);
  const key = await live.queueComment(ticketId, localBody, { commentId, baseBody: base,
    sourceNotesHash: computeNotesHash(base), documentUri: doc.uri.toString() });
  await live.request({ method: "PUT", path: `/journals/${commentId}.json`, body: { journal: { notes: remoteBody } } });
  const outcome = await live.engine().syncOne(key, live.context);
  assert.strictEqual(outcome.kind, "conflict");
  if (outcome.kind !== "conflict" || !("commentConflictContext" in outcome) || !outcome.commentConflictContext) {
    throw new Error("コメントの競合情報がありません。");
  }
  return { key, ticketId, commentId, editor, context: outcome.commentConflictContext };
};

liveTest("LIVE-C01", "チケットのリモート優先で本文と古いキューを置換する", async (live) => {
  const item = await ticketConflict(live);
  const result = await applyRemoteContent(item.context, item.editor, live.scope);
  assert.strictEqual(result.status, "success", result.message);
  assert.ok(item.editor.document.getText().includes(remoteBody));
  assert.strictEqual(getOfflineSyncQueue(live.scope).tickets.has(item.ticketId), false);
  assert.strictEqual(lf((await live.readIssue(item.ticketId)).ticket.description), remoteBody);
});
liveTest("LIVE-C02", "チケットのローカル優先で明示的に最新remote baseへrebaseする", async (live) => {
  const item = await ticketConflict(live);
  const result = await forceSaveLocal(item.context, item.editor, live.scope, live.engine());
  assert.strictEqual(result.status, "success", result.message);
  assert.strictEqual(lf((await live.readIssue(item.ticketId)).ticket.description), localBody);
});
liveTest("LIVE-C03", "チケットの三者マージを確認後に実Redmineへ保存できる", async (live) => {
  const item = await ticketConflict(live);
  const result = await mergeTicketContent(item.context, item.editor, live.scope);
  assert.strictEqual(result.status, "merged", result.message);
  assert.ok(item.editor.document.getText().includes("local first\nsecond\nremote third"));
  assert.strictEqual(lf((await live.readIssue(item.ticketId)).ticket.description), remoteBody);
  const key = await live.queueTicket(item.ticketId, { description: "local first\nsecond\nremote third" });
  assert.strictEqual((await live.engine().syncOne(key, live.context)).kind, "completed");
  assert.strictEqual(lf((await live.readIssue(item.ticketId)).ticket.description), "local first\nsecond\nremote third");
});
liveTest("LIVE-C04", "チケットの競合ダイアログをキャンセルしても本文とキューを保持する", async (live) => {
  const item = await ticketConflict(live);
  const previous = item.editor.document.getText();
  const result = await handleConflict({ status: "conflict", message: "conflict", conflictContext: item.context }, item.editor, {
    showConflictDialog: async () => "cancel", applyRemoteContent, mergeTicketContent, forceSaveLocal,
  }, live.scope, live.engine());
  assert.strictEqual(result.status, "conflict");
  assert.strictEqual(item.editor.document.getText(), previous);
  assert.ok(getOfflineSyncQueue(live.scope).tickets.has(item.ticketId));
});
liveTest("LIVE-C05", "コメントのリモート優先でremote本文を採用する", async (live) => {
  const item = await commentConflict(live);
  const result = await applyRemoteCommentContent(item.context, item.editor, live.scope);
  assert.strictEqual(result.status, "success", result.message);
  assert.strictEqual(item.editor.document.getText(), remoteBody);
  assert.strictEqual(getOfflineSyncQueue(live.scope).comments.length, 0);
});
liveTest("LIVE-C06", "コメントのローカル優先でremote hashを更新してPUTする", async (live) => {
  const item = await commentConflict(live);
  const result = await forceCommentSaveLocal(item.context, item.editor, live.scope, live.engine());
  assert.strictEqual(result.status, "success", result.message);
  assert.strictEqual((await live.readIssue(item.ticketId)).comments.find((comment) => comment.id === item.commentId)?.body, localBody);
});
liveTest("LIVE-C07", "コメントの三者マージをremote基準で再送できる", async (live) => {
  const item = await commentConflict(live);
  assert.strictEqual((await mergeCommentContent(item.context, item.editor, live.scope)).status, "merged");
  const body = item.editor.document.getText();
  assert.strictEqual(body, "local first\nsecond\nremote third");
  const key = await live.queueComment(item.ticketId, body, { commentId: item.commentId, baseBody: remoteBody });
  assert.strictEqual((await live.engine().syncOne(key, live.context)).kind, "completed");
  assert.strictEqual((await live.readIssue(item.ticketId)).comments.find((comment) => comment.id === item.commentId)?.body, body);
});

for (const kind of ["ticket", "comment"] as const) {
  liveTest(kind === "ticket" ? "LIVE-C08" : "LIVE-C09", `${kind}の追加編集を古いマージ結果で上書きしない`, async (live) => {
    const item = kind === "ticket" ? await ticketConflict(live) : await commentConflict(live);
    const newer = `${item.editor.document.getText()}\nNew unsaved edit`;
    await applyEditorContent(item.editor, newer);
    const result = "commentId" in item
      ? await mergeCommentContent(item.context, item.editor, live.scope)
      : await mergeTicketContent(item.context, item.editor, live.scope);
    assert.strictEqual(result.status, "conflict", result.message);
    assert.strictEqual(item.editor.document.getText(), newer);
    assert.strictEqual(lf((await live.readIssue(item.ticketId)).ticket.description), kind === "ticket" ? remoteBody : "Base body");
  });
  liveTest(kind === "ticket" ? "LIVE-C10" : "LIVE-C11", `${kind}の永続化失敗時は実文書とキューを復元する`, async (live) => {
    const item = kind === "ticket" ? await ticketConflict(live) : await commentConflict(live);
    const previous = item.editor.document.getText();
    const original = live.storage.update.bind(live.storage);
    live.storage.update = async () => { throw new Error("live persistence failure"); };
    try {
      if ("commentId" in item) {
        await assert.rejects(mergeCommentContent(item.context, item.editor, live.scope), /live persistence failure/);
      } else {
        await assert.rejects(mergeTicketContent(item.context, item.editor, live.scope), /live persistence failure/);
      }
      assert.strictEqual(item.editor.document.getText(), previous);
    } finally { live.storage.update = original; }
  });
}

liveTest("LIVE-C12", "マージ競合マーカーを含む本文はremoteへ送信しない", async (live) => {
  const id = await live.createIssue();
  const initial = (await live.readIssue(id)).ticket.description;
  const key = await live.queueTicket(id, { description: "<<<<<<< Local\nlocal\n=======\nremote\n>>>>>>> Remote" });
  const outcome = await live.engine().syncOne(key, live.context);
  assert.notStrictEqual(outcome.kind, "completed");
  assert.strictEqual(live.proxy.hits().filter((hit) => hit.method === "PUT").length, 0);
  assert.strictEqual((await live.readIssue(id)).ticket.description, initial);
});
