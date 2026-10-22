import * as assert from "assert";
import * as vscode from "vscode";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { computeNotesHash } from "../utils/notesHash";
import { clearCommentEdits, getCommentEdit } from "../views/commentEditStore";
import { saveCommentDocumentLocally } from "../views/commentSaveSync";
import {
  buildCommentUpdateFileContent,
  parseCommentUpdateFile,
} from "../views/commentUpdateFile";
import {
  applyRemoteCommentContent,
  forceCommentSaveLocal,
  mergeCommentContent,
} from "../views/conflictResolver";
import type { CommentConflictContext } from "../views/commentSaveTypes";
import {
  addOfflineCommentUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { createMutableEditorStub } from "./helpers/editorStubs";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("コメント競合からの復旧", () => {
  const scope = getCurrentConnectionScope();
  const ticketId = 901;
  const commentId = 902;
  const baseBody = "first\nsecond\nthird";
  const localBody = "local first\nsecond\nthird";
  const remoteBody = "first\nsecond\nremote third";
  const context: CommentConflictContext = {
    connectionScope: scope,
    ticketId,
    commentId,
    baseBody,
    localBody,
    remoteBody,
    remoteUpdatedAt: "2026-10-22T01:00:00Z",
  };
  const fields = {
    issueId: ticketId,
    journalId: commentId,
    projectId: 7,
    issueSubject: "Issue subject",
    commentAuthor: "Author",
    sourceNotesHash: computeNotesHash(baseBody),
  };
  const updateEditor = () => createMutableEditorStub(
    vscode.Uri.file(`/tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`),
    buildCommentUpdateFileContent(fields, localBody),
  );
  const enqueue = async (editor: vscode.TextEditor, sourceNotesHash?: string): Promise<void> => {
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody,
      body: localBody,
      lastKnownRemoteUpdatedAt: "2026-10-21T01:00:00Z",
      sourceNotesHash,
      documentUri: editor.document.uri.toString(),
    }, scope);
  };

  setup(() => {
    clearCommentEdits();
    initializeOfflineSyncStore(createTestMemento(), scope);
  });
  teardown(() => clearCommentEdits());

  test("サーバ優先は更新ファイルの identity と表示情報を保持して基準 hash を更新する", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);

    const result = await applyRemoteCommentContent(context, editor, scope);

    assert.strictEqual(result.status, "success");
    const parsed = parseCommentUpdateFile(editor.document.getText());
    assert.ok(parsed);
    assert.strictEqual(parsed.body, remoteBody);
    assert.deepStrictEqual(parsed.fields, {
      ...fields,
      sourceNotesHash: computeNotesHash(remoteBody),
      lastSyncedAt: parsed.fields.lastSyncedAt,
    });
    assert.ok(parsed.fields.lastSyncedAt);
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0);
    assert.strictEqual(getCommentEdit(commentId, scope)?.baseBody, remoteBody);
  });

  test("マージ後の更新ファイルを保存すると最新のサーバ本文を基準に再登録できる", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);

    const result = await mergeCommentContent(context, editor, scope);

    assert.strictEqual(result.status, "merged");
    const parsed = parseCommentUpdateFile(editor.document.getText());
    assert.ok(parsed);
    assert.strictEqual(parsed.body, "local first\nsecond\nremote third");
    assert.strictEqual(parsed.fields.issueId, ticketId);
    assert.strictEqual(parsed.fields.journalId, commentId);
    assert.strictEqual(parsed.fields.sourceNotesHash, computeNotesHash(remoteBody));
    assert.strictEqual(getCommentEdit(commentId, scope)?.baseBody, remoteBody);
    const saved = await saveCommentDocumentLocally({
      ticketId,
      commentId,
      content: editor.document.getText(),
      documentUri: editor.document.uri,
      operationScope: scope,
    });
    assert.strictEqual(saved.status, "queued");
    const queued = getOfflineSyncQueue(scope).comments[0];
    assert.strictEqual(queued.body, parsed.body);
    assert.strictEqual(queued.sourceNotesHash, computeNotesHash(remoteBody));
  });

  test("ローカル優先はメモリの編集状態がなくても本文エディタを hash 形式へ変更せず同期する", async () => {
    const editor = createMutableEditorStub(vscode.Uri.file("/tmp/comment-body.md"), localBody);
    await enqueue(editor);
    assert.strictEqual(getCommentEdit(commentId, scope), undefined);
    let syncCalls = 0;

    const result = await forceCommentSaveLocal(context, editor, scope, {
      syncOne: async (key) => {
        syncCalls++;
        assert.strictEqual(key.kind, "comment");
        const queued = getOfflineSyncQueue(scope).comments[0];
        assert.strictEqual(queued.baseBody, remoteBody);
        assert.strictEqual(queued.lastKnownRemoteUpdatedAt, context.remoteUpdatedAt);
        assert.strictEqual(queued.sourceNotesHash, undefined);
        return { kind: "completed", ticketId, commentId };
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(syncCalls, 1);
    assert.strictEqual(editor.document.getText(), localBody);
  });

  test("ローカル優先は更新ファイルの hash を rebase 後に更新し再保存できる", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);

    const result = await forceCommentSaveLocal(context, editor, scope, {
      syncOne: async () => {
        const queued = getOfflineSyncQueue(scope).comments[0];
        assert.strictEqual(queued.sourceNotesHash, computeNotesHash(remoteBody));
        const parsed = parseCommentUpdateFile(editor.document.getText());
        assert.ok(parsed);
        assert.strictEqual(parsed.body, localBody);
        assert.strictEqual(parsed.fields.sourceNotesHash, computeNotesHash(remoteBody));
        return { kind: "failed_before_commit", error: new Error("offline") };
      },
    });

    assert.strictEqual(result.status, "failed");
    const saved = await saveCommentDocumentLocally({
      ticketId,
      commentId,
      content: editor.document.getText(),
      documentUri: editor.document.uri,
      operationScope: scope,
    });
    assert.strictEqual(saved.status, "queued");
    assert.strictEqual(getOfflineSyncQueue(scope).comments[0].sourceNotesHash, computeNotesHash(remoteBody));
  });

  test("本文エディタでも永続キューにある hash はローカル優先で更新する", async () => {
    const editor = createMutableEditorStub(vscode.Uri.file("/tmp/comment-body.md"), localBody);
    await enqueue(editor, fields.sourceNotesHash);

    const result = await forceCommentSaveLocal(context, editor, scope, {
      syncOne: async () => {
        assert.strictEqual(getOfflineSyncQueue(scope).comments[0].sourceNotesHash, computeNotesHash(remoteBody));
        return { kind: "completed", ticketId, commentId };
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(editor.document.getText(), localBody);
  });

  test("ローカル優先で header 更新に失敗しても再送せず rebase 済みのキューを残す", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);
    editor.edit = async () => false;

    await assert.rejects(forceCommentSaveLocal(context, editor, scope, {
      syncOne: async () => assert.fail("header 更新失敗時に送信してはいけない"),
    }), /editor_edit_failed/);

    const queued = getOfflineSyncQueue(scope).comments[0];
    assert.strictEqual(queued.phase, "queued");
    assert.strictEqual(queued.body, localBody);
    assert.strictEqual(queued.baseBody, remoteBody);
    assert.strictEqual(queued.sourceNotesHash, computeNotesHash(remoteBody));
  });

  test("ローカル優先の古い operation は更新ファイルを変更せず拒否する", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);
    const queued = getOfflineSyncQueue(scope).comments[0];
    const before = editor.document.getText();

    const result = await forceCommentSaveLocal(context, editor, scope, {
      syncOne: async () => assert.fail("古い operation を送信してはいけない"),
    }, {
      operationId: queued.operationId,
      revision: (queued.revision ?? 1) + 1,
      body: queued.body,
    });

    assert.strictEqual(result.status, "conflict");
    assert.strictEqual(editor.document.getText(), before);
    assert.deepStrictEqual(getOfflineSyncQueue(scope).comments[0], queued);
  });

  test("別コメントの更新ファイルは本文やキューを変更せず拒否する", async () => {
    const editor = updateEditor();
    await enqueue(editor, fields.sourceNotesHash);
    const before = editor.document.getText();
    const queueBefore = getOfflineSyncQueue(scope);

    const result = await applyRemoteCommentContent({ ...context, commentId: commentId + 1 }, editor, scope);

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(editor.document.getText(), before);
    assert.deepStrictEqual(getOfflineSyncQueue(scope), queueBefore);
  });
});
