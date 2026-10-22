import * as assert from "assert";
import * as vscode from "vscode";
import { getCurrentConnectionScope } from "../config/connectionScope";
import {
  applyRemoteCommentContent,
  applyRemoteContent,
  mergeCommentContent,
  mergeTicketContent,
} from "../views/conflictResolver";
import type { CommentConflictContext, CommentSaveResult } from "../views/commentSaveTypes";
import type { ConflictContext, TicketSaveResult } from "../views/ticketSaveTypes";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { clearCommentEdits, getCommentEdit } from "../views/commentEditStore";
import { clearTicketDrafts, getTicketDraft, initializeTicketDraft } from "../views/ticketDraftStore";
import { createMutableEditorStub, createTicketContentFixture } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("競合解決のエディターとキューの整合性", () => {
  const scope = getCurrentConnectionScope();
  const ticketId = 941;
  const commentId = 942;
  const metadata = buildIssueMetadataFixture();
  const commentContext: CommentConflictContext = {
    ticketId,
    commentId,
    baseBody: "first\nsecond\nthird",
    localBody: "local first\nsecond\nthird",
    remoteBody: "first\nsecond\nremote third",
    remoteUpdatedAt: "t2",
  };
  const ticketContext: ConflictContext = {
    ticketId,
    baseSubject: "Base",
    localSubject: "Local",
    remoteSubject: "Remote",
    baseDescription: commentContext.baseBody,
    localDescription: commentContext.localBody,
    remoteDescription: commentContext.remoteBody,
    remoteMetadata: metadata,
    remoteUpdatedAt: "t2",
  };
  const remoteDetail = {
    ticket: { id: ticketId, projectId: 7, subject: "Remote", description: "Remote body", updatedAt: "t2" },
    comments: [],
  };
  let storage: ReturnType<typeof createTestMemento>;

  setup(() => {
    storage = createTestMemento();
    initializeOfflineSyncStore(storage, scope);
    clearCommentEdits();
    clearTicketDrafts(scope);
  });
  teardown(() => {
    clearCommentEdits();
    clearTicketDrafts(scope);
  });

  const variants: Array<{
    name: string;
    comment: boolean;
    resolve: (editor: vscode.TextEditor) => Promise<CommentSaveResult | TicketSaveResult>;
  }> = [
    { name: "コメントのリモート優先", comment: true,
      resolve: (editor) => applyRemoteCommentContent(commentContext, editor, scope) },
    { name: "コメントのマージ", comment: true,
      resolve: (editor) => mergeCommentContent(commentContext, editor, scope) },
    { name: "チケットのマージ", comment: false,
      resolve: (editor) => mergeTicketContent(ticketContext, editor, scope) },
    { name: "チケットのリモート優先", comment: false,
      resolve: (editor) => applyRemoteContent(ticketContext, editor, scope, undefined, {
        getIssueDetail: async () => remoteDetail,
      }) },
  ];

  for (const variant of variants) {
    const prepare = async () => {
      const content = variant.comment ? commentContext.localBody
        : createTicketContentFixture("Local", commentContext.localBody);
      const editor = createMutableEditorStub(vscode.Uri.file(`/tmp/conflict-rollback-${variant.comment}.md`), content);
      let version = 1;
      Object.defineProperty(editor.document, "version", { get: () => version });
      const setText = editor.document.setText;
      editor.document.setText = (text: string) => { version++; setText(text); };
      if (variant.comment) {
        await addOfflineCommentUpdateAsync({ ticketId, commentId, body: content, baseBody: commentContext.baseBody }, scope);
      } else {
        initializeTicketDraft(ticketId, "Base", "Base body", metadata, "t1", scope);
        await addOfflineTicketUpdateAsync(ticketId, {
          ticketId, subject: "Local", description: commentContext.localBody, metadata, content,
          baseSubject: "Base", baseDescription: "Base body", baseMetadata: metadata,
          lastKnownRemoteUpdatedAt: "t1", phase: "queued", revision: 1,
        }, scope);
      }
      return editor;
    };
    const queued = () => variant.comment ? getOfflineSyncQueue(scope).comments[0]
      : getOfflineSyncQueue(scope).tickets.get(ticketId);
    const assertBaseUnchanged = () => {
      if (variant.comment) { assert.strictEqual(getCommentEdit(commentId, scope), undefined); }
      else {
        assert.strictEqual(getTicketDraft(ticketId, scope)?.baseSubject, "Base");
        assert.strictEqual(getTicketDraft(ticketId, scope)?.lastKnownRemoteUpdatedAt, "t1");
      }
    };

    test(`${variant.name}: 永続化失敗時は元の本文とキューを保持する`, async () => {
      const editor = await prepare();
      const previousContent = editor.document.getText();
      const previousQueue = structuredClone(queued());
      storage.update = async () => { throw new Error("persist rejected"); };

      const result = await variant.resolve(editor).catch((error: unknown) => ({ status: "failed", message: String(error) }));

      assert.strictEqual(result.status, "failed");
      assert.match(result.message, /persist rejected/);
      assert.strictEqual(editor.document.getText(), previousContent);
      assert.deepStrictEqual(queued(), previousQueue);
      assertBaseUnchanged();
      initializeOfflineSyncStore(storage, scope);
      assert.strictEqual(queued()?.operationId, previousQueue?.operationId);
      assert.strictEqual(queued()?.revision, previousQueue?.revision);
      const restored = getOfflineSyncQueue(scope);
      assert.strictEqual(variant.comment ? restored.comments[0].body : restored.tickets.get(ticketId)?.content,
        previousContent);
    });

    test(`${variant.name}: 編集適用中にキューが変われば新しいキューを残して本文を戻す`, async () => {
      const editor = await prepare();
      const previousContent = editor.document.getText();
      const edit = editor.edit.bind(editor);
      let firstEdit = true;
      editor.edit = async (...args: Parameters<typeof editor.edit>) => {
        const changed = await edit(...args);
        if (firstEdit) {
          firstEdit = false;
          if (variant.comment) {
            await addOfflineCommentUpdateAsync({ ...getOfflineSyncQueue(scope).comments[0], body: "New queued body" }, scope);
          } else {
            const current = getOfflineSyncQueue(scope).tickets.get(ticketId)!;
            await addOfflineTicketUpdateAsync(ticketId, { ...current, content: "New queued body" }, scope);
          }
        }
        return changed;
      };

      const result = await variant.resolve(editor);

      assert.strictEqual(result.status, "conflict");
      assert.strictEqual(editor.document.getText(), previousContent);
      const currentQueue = getOfflineSyncQueue(scope);
      assert.strictEqual(variant.comment ? currentQueue.comments[0].body : currentQueue.tickets.get(ticketId)?.content,
        "New queued body");
      assertBaseUnchanged();
    });

    test(`${variant.name}: 永続化待機中の追加編集はロールバックで消さない`, async () => {
      const editor = await prepare();
      const previousQueue = structuredClone(queued());
      storage.update = async () => {
        editor.document.setText("New editor body");
        throw new Error("persist rejected");
      };

      await variant.resolve(editor).catch(() => undefined);

      assert.strictEqual(editor.document.getText(), "New editor body");
      assert.deepStrictEqual(queued(), previousQueue);
      assertBaseUnchanged();
    });

    test(`${variant.name}: エディター編集が拒否されてもキューを削除しない`, async () => {
      const editor = await prepare();
      const previousContent = editor.document.getText();
      const previousQueue = structuredClone(queued());
      editor.edit = async () => false;

      const result = await variant.resolve(editor).catch((error: unknown) => ({ status: "failed", message: String(error) }));

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(editor.document.getText(), previousContent);
      assert.deepStrictEqual(queued(), previousQueue);
      assertBaseUnchanged();
    });

    test(`${variant.name}: 競合検出後の未保存編集は古い競合内容で置き換えない`, async () => {
      const editor = await prepare();
      const previousQueue = structuredClone(queued());
      const newerContent = variant.comment ? "New unsaved comment"
        : createTicketContentFixture("New unsaved subject", "New unsaved body");
      editor.document.setText(newerContent);

      const result = await variant.resolve(editor);

      assert.strictEqual(result.status, "conflict");
      assert.strictEqual(editor.document.getText(), newerContent);
      assert.deepStrictEqual(queued(), previousQueue);
      assertBaseUnchanged();
    });
  }

  test("チケットのリモート取得待機中に編集された本文は置き換えない", async () => {
    const editor = createMutableEditorStub(vscode.Uri.file("/tmp/conflict-remote-get.md"),
      createTicketContentFixture(ticketContext.localSubject, ticketContext.localDescription));
    const result = await applyRemoteContent(ticketContext, editor, scope, undefined, {
      getIssueDetail: async () => {
        editor.document.setText("New body during GET");
        return remoteDetail;
      },
    });
    assert.strictEqual(result.status, "conflict");
    assert.strictEqual(editor.document.getText(), "New body during GET");
  });

  for (const resolution of ["remote", "merge"] as const) {
    test(`チケットの${resolution}: 画像変換後の競合文脈でも元の保存本文は解決できる`, async () => {
      const original = "![fixture](./screen.png)";
      const content = createTicketContentFixture("Local", original);
      const editor = createMutableEditorStub(vscode.Uri.file("/tmp/conflict-image-ticket.md"), content);
      initializeTicketDraft(ticketId, "Base", "Base body", metadata, "t1", scope);
      await addOfflineTicketUpdateAsync(ticketId, {
        ticketId, subject: "Local", description: original, metadata, content,
        baseSubject: "Base", baseDescription: "Base body", baseMetadata: metadata,
        phase: "queued", revision: 1,
      }, scope);
      const context = { ...ticketContext, localDescription: "![fixture](screen.png)" };

      const result = resolution === "remote"
        ? await applyRemoteContent(context, editor, scope, undefined, { getIssueDetail: async () => remoteDetail })
        : await mergeTicketContent(context, editor, scope);

      assert.strictEqual(result.status, resolution === "remote" ? "success" : "merged");
      assert.strictEqual(getOfflineSyncQueue(scope).tickets.size, 0);
    });
  }
});
