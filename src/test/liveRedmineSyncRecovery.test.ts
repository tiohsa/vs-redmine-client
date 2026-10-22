import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { createSyncEngine } from "../app/syncEngine";
import { initializeApiKeyStore, setApiKeyForScope, clearApiKeyForScope } from "../config/apiKeyStore";
import { normalizeBaseUrl, requestJson, runWithConnectionScope } from "../redmine/client";
import { addComment, updateComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
import { createIssue, deleteIssue, getIssueDetail } from "../redmine/issues";
import { getCurrentUserId } from "../redmine/users";
import { MemorySecretStorage } from "./helpers/secretStorage";
import { createTestMemento } from "./helpers/vscodeMemento";
import {
  addOfflineCommentUpdateAsync,
  getActiveScope,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  removeOfflineCommentEntryAsync,
  switchOfflineSyncStore,
} from "../views/offlineSyncStore";
import { getPrimaryEffectForRevision } from "../app/syncEffects";
import { applyRemoteCommentContent } from "../views/conflictResolver";
import { getCommentEdit, clearCommentEdits } from "../views/commentEditStore";

const liveUrl = process.env.REDMINE_SYNC_LIVE_URL?.trim();
const apiKey = process.env.REDMINE_API_KEY;
const normalizedLiveUrl = (() => {
  if (!liveUrl) { return undefined; }
  try {
    return normalizeBaseUrl(liveUrl);
  } catch {
    return undefined;
  }
})();
const liveSuite = normalizedLiveUrl === "http://127.0.0.1:3000/" && apiKey ? suite : suite.skip;

liveSuite("実Redmine同期リカバリー", function () {
  this.timeout(120_000);

  test("画像付きコメントの復旧と競合解決失敗時の本文保持を検証する", async () => {
    const scope = normalizedLiveUrl!;
    const previousScope = getActiveScope();
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    const storage = createTestMemento();
    const testId = randomUUID();
    const operationId = `live-comment-${testId}`;
    const subject = `Live sync recovery ${testId}`;
    const bodyMarker = `Live sync recovery comment ${testId}`;
    const fixtureName = `live-sync-image-${testId.slice(0, 8)}.png`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-redmine-live-sync-"));
    const fixturePath = path.join(tempDir, fixtureName);
    let issueId: number | undefined;
    let apiKeyStoreInitialized = false;

    try {
      await initializeApiKeyStore(secrets, subscriptions);
      apiKeyStoreInitialized = true;
      await setApiKeyForScope(scope, apiKey!);
      initializeOfflineSyncStore(storage, scope);

      await runWithConnectionScope(scope, async () => {
        const currentUserId = await getCurrentUserId();
        const currentUser = await requestJson<{ user: { id: number; login: string } }>({
          method: "GET",
          path: "/users/current.json",
        });
        assert.strictEqual(currentUser.user.login, "admin", "このテストにはadminアカウントが必要です");
        assert.strictEqual(currentUserId, currentUser.user.id);

        const createdIssueId = await createIssue({
          projectId: 35,
          subject,
          description: `Temporary live sync recovery fixture ${testId}`,
        });
        assert.ok(createdIssueId, "Redmineが作成したissue IDを返すこと");
        issueId = createdIssueId;

        fs.writeFileSync(
          fixturePath,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pHsAAAAASUVORK5CYII=",
            "base64",
          ),
        );
        const body = `${bodyMarker}\n\n![fixture](./${fixtureName})`;
        await addOfflineCommentUpdateAsync({
          ticketId: createdIssueId,
          operationId,
          body,
          baseDir: tempDir,
        }, scope);

        let postedCommentCount = 0;
        const engine = createSyncEngine({
          comments: {
            addComment: async (ticketId, notes, uploads) => {
              await addComment(ticketId, notes, uploads);
              postedCommentCount += 1;
              throw new Error("ETIMEDOUT after successful comment write");
            },
            getIssueDetail,
            getCurrentUserId,
            uploadFile: uploadFileAttachment,
          },
        });
        const key = { kind: "comment" as const, ticketId: createdIssueId, operationId };
        const context = { connectionScope: scope };

        const firstOutcome = await engine.syncOne(key, context);
        assert.strictEqual(firstOutcome.kind, "commit_unknown");
        assert.strictEqual(postedCommentCount, 1, "成功したremote POSTが1回だけであること");

        const operation = engine.getRepository().getOperation(key, scope);
        assert.ok(operation, "comment operationが永続化されていること");
        const primaryEffect = getPrimaryEffectForRevision(operation!);
        assert.ok(primaryEffect, "primary comment effectが永続化されていること");
        assert.strictEqual(primaryEffect!.state, "commit_unknown");
        assert.strictEqual(primaryEffect!.requestSnapshot?.kind, "comment_create");
        if (primaryEffect!.requestSnapshot?.kind !== "comment_create") {
          throw new Error("Expected a persisted comment create request snapshot");
        }
        const snapshot = primaryEffect!.requestSnapshot.request;
        assert.strictEqual(snapshot.ticketId, createdIssueId);
        assert.ok(snapshot.notes.includes(bodyMarker));
        assert.ok(snapshot.notes.includes(fixtureName), "変換後notesにアップロード済み画像リンクが含まれること");
        assert.ok(!snapshot.notes.includes(`./${fixtureName}`), "request snapshotにローカル相対パスが残らないこと");
        assert.strictEqual(snapshot.uploads?.length, 1);
        assert.ok(snapshot.uploads?.[0]?.token, "request snapshotにRedmine upload tokenが保持されていること");

        const detail = await getIssueDetail(createdIssueId);
        const remoteComment = detail.comments.find((comment) =>
          comment.authorId === currentUserId && comment.body === snapshot.notes);
        assert.ok(remoteComment, "実issueにfrozen notesと一致するjournalが存在すること");

        const resolution = await engine.resolveCommentCommitUnknown({
          key,
          context,
          operationId: operation!.operationId,
          operationRevision: operation!.intentRevision ?? operation!.revision,
          attemptGeneration: operation!.attemptGeneration,
          resolution: { kind: "link_remote_comment", commentId: remoteComment!.id },
        });
        assert.strictEqual(resolution.kind, "completed");
        assert.strictEqual(postedCommentCount, 1, "remote journalへのリンク後にコメントを再投稿しないこと");
        assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0, "解決済みqueue entryが削除されること");

        const remoteBody = `${snapshot.notes}\nRemote edit`;
        await updateComment(remoteComment!.id, remoteBody);
        const editedDetail = await getIssueDetail(createdIssueId);
        const editedRemote = editedDetail.comments.find((comment) => comment.id === remoteComment!.id);
        assert.strictEqual(editedRemote?.body, remoteBody);
        const localBody = `${snapshot.notes}\nLocal edit`;
        const document = await vscode.workspace.openTextDocument({ content: localBody, language: "markdown" });
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        await addOfflineCommentUpdateAsync({
          ticketId: createdIssueId,
          commentId: remoteComment!.id,
          body: localBody,
          baseBody: snapshot.notes,
          documentUri: document.uri.toString(),
        }, scope);
        const previousQueue = structuredClone(getOfflineSyncQueue(scope).comments);
        const previousEdit = structuredClone(getCommentEdit(remoteComment!.id, scope));
        const updateStorage = storage.update;
        storage.update = async () => { throw new Error("injected persistence failure"); };
        try {
          await assert.rejects(applyRemoteCommentContent({
            ticketId: createdIssueId,
            commentId: remoteComment!.id,
            baseBody: snapshot.notes,
            localBody,
            remoteBody,
            remoteUpdatedAt: editedRemote?.updatedAt,
          }, editor, scope), /injected persistence failure/);
          assert.strictEqual(document.getText(), localBody, "VS Code文書も元のローカル本文へ戻ること");
          assert.deepStrictEqual(getOfflineSyncQueue(scope).comments, previousQueue);
          assert.deepStrictEqual(getCommentEdit(remoteComment!.id, scope), previousEdit);
          const afterFailure = await getIssueDetail(createdIssueId);
          assert.strictEqual(afterFailure.comments.find((comment) => comment.id === remoteComment!.id)?.body, remoteBody);
        } finally {
          storage.update = updateStorage;
          await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        }
      });
    } finally {
      try {
        if (issueId !== undefined) {
          await runWithConnectionScope(scope, () => deleteIssue(issueId!));
        }
      } finally {
        try {
          if (issueId !== undefined) {
            for (const entry of getOfflineSyncQueue(scope).comments.filter((item) => item.ticketId === issueId)) {
              await removeOfflineCommentEntryAsync({
                ticketId: issueId,
                commentId: entry.commentId,
                documentUri: entry.documentUri,
                operationId: entry.operationId,
              }, scope);
            }
          }
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
          clearCommentEdits();
          switchOfflineSyncStore(previousScope);
          try {
            if (apiKeyStoreInitialized) {
              await clearApiKeyForScope(scope);
            }
          } finally {
            subscriptions.forEach((subscription) => subscription.dispose());
            secrets.dispose();
          }
        }
      }
    }
  });
});
