import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommentCreateHandler, CommentUpdateHandler } from "../app/ticketSync/operationHandlers";
import { createSyncOperationRepository, DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import type { DurableSyncEffectAction, DurableSyncEffectState } from "../app/syncEffects";
import type { CommentCreateIntent, CommentUpdateIntent, UnifiedSyncOperation } from "../app/ticketSync/syncOperationTypes";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import * as vscode from "vscode";

const SCOPE = "https://comment-image-effects.example.org/";

const createOperation = (
  baseDir: string,
  body: string,
): UnifiedSyncOperation<CommentUpdateIntent> => ({
  operationId: `${SCOPE}:comment:10:20`,
  kind: "comment_update",
  key: { kind: "comment", ticketId: 10, commentId: 20 },
  connectionScope: SCOPE,
  phase: "preparing",
  revision: 1,
  intentRevision: 1,
  attemptGeneration: 1,
  persistenceVersion: 1,
  ticketId: 10,
  commentId: 20,
  intent: {
    ticketId: 10,
    commentId: 20,
    body,
    baseDir,
  },
});

const createCommentOperation = (
  baseDir: string,
  body: string,
): UnifiedSyncOperation<CommentCreateIntent> => ({
  ...createOperation(baseDir, body),
  operationId: `${SCOPE}:comment-create:10`,
  kind: "comment_create",
  key: { kind: "comment", ticketId: 10, documentUri: "file:///comment.md" },
  commentId: undefined,
  intent: { ticketId: 10, body, baseDir },
});

suite("Comment markdown durable image effects", () => {
  test("旧キューのbaseDir欠落時もdocumentUriから画像を解決してuploadする", async () => {
    const scope = `${SCOPE}legacy-base-dir`;
    initializeOfflineSyncStore(createTestMemento(), scope);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-legacy-base-dir-"));
    fs.writeFileSync(path.join(dir, "screen.png"), "image");
    const body = "![image](screen.png)";
    const original = createCommentOperation(dir, body);
    const documentUri = vscode.Uri.file(path.join(dir, "comment.md")).toString();
    const operation: UnifiedSyncOperation<CommentCreateIntent> = {
      ...original,
      connectionScope: scope,
      operationId: `${scope}:comment-create:legacy`,
      documentUri,
      intent: {
        ticketId: 10,
        body,
        baseDir: undefined,
        documentUri,
      },
    };
    const repo = createSyncOperationRepository();
    await repo.saveOperation(operation, scope);

    let uploadCalls = 0;
    const handler = new CommentCreateHandler();
    const preparedResult = await handler.prepare(operation, { connectionScope: scope }, { repository: repo });
    assert.strictEqual(preparedResult.ok, true);
    if (!preparedResult.ok) {
      return;
    }
    const secondary = await handler.executeSecondaryEffects!(
      operation,
      preparedResult.prepared,
      { connectionScope: scope },
      {
        repository: repo,
        comment: {
          uploadFile: async () => {
            uploadCalls++;
            return { token: "legacy-token", filename: "screen.png", contentType: "image/png" };
          },
        },
      },
    );
    assert.strictEqual(secondary.ok, true);
    assert.strictEqual(uploadCalls, 1);
  });

  test("Comment Createでも同一画像のuploadとtokenをdedupeする", async () => {
    initializeOfflineSyncStore(createTestMemento(), `${SCOPE}create`);
    const scope = `${SCOPE}create`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-create-image-effects-"));
    fs.writeFileSync(path.join(dir, "screen.png"), "image");
    const body = "![a](./screen.png)\n![b](./screen.png)";
    const repo = createSyncOperationRepository();
    const operation = { ...createCommentOperation(dir, body), connectionScope: scope, operationId: `${scope}:comment-create:10` };
    await repo.saveOperation(operation, scope);

    let uploadCalls = 0;
    let addCommentCalls = 0;
    const handler = new CommentCreateHandler();
    const deps = {
      repository: repo,
      comment: {
        uploadFile: async () => {
          uploadCalls++;
          return { token: "image-token", filename: "screen.png", contentType: "image/png" };
        },
        addComment: async () => { addCommentCalls++; },
      },
    };
    const context = { connectionScope: scope };
    const preparedResult = await handler.prepare(operation, context, deps);
    assert.strictEqual(preparedResult.ok, true);
    if (!preparedResult.ok) {
      return;
    }
    const secondary = await handler.executeSecondaryEffects!(operation, preparedResult.prepared, context, deps);
    assert.strictEqual(secondary.ok, true);
    assert.strictEqual(uploadCalls, 1);
    const remote = await handler.executeRemoteWrite(operation, preparedResult.prepared, context, deps);
    assert.strictEqual(remote.ok, true);
    assert.strictEqual(addCommentCalls, 1);
  });

  test("同一画像は1回だけuploadし、attachment-link後にcomment updateする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-image-effects-"));
    const imagePath = path.join(dir, "screen.png");
    fs.writeFileSync(imagePath, "image");
    const body = "![a](./screen.png)\n![b](./screen.png)";
    const repo = createSyncOperationRepository();
    const operation = createOperation(dir, body);
    await repo.saveOperation(operation, SCOPE);

    let uploadCalls = 0;
    let updateIssueCalls = 0;
    let updateCommentCalls = 0;
    const handler = new CommentUpdateHandler();
    const deps = {
      repository: repo,
      comment: {
        uploadFile: async (filePath: string) => {
          uploadCalls++;
          assert.notStrictEqual(filePath, imagePath, "source fileではなくspoolをuploadすること");
          return { token: "image-token", filename: "screen.png", contentType: "image/png" };
        },
        updateIssue: async () => { updateIssueCalls++; },
        updateComment: async () => { updateCommentCalls++; },
      },
    };
    const context = { connectionScope: SCOPE };
    const preparedResult = await handler.prepare(operation, context, deps);
    assert.strictEqual(preparedResult.ok, true);
    if (!preparedResult.ok) {
      return;
    }

    const secondary = await handler.executeSecondaryEffects!(operation, preparedResult.prepared, context, deps);
    assert.strictEqual(secondary.ok, true);
    assert.strictEqual(uploadCalls, 1);
    assert.strictEqual(updateIssueCalls, 1);

    const saved = repo.getOperation(operation.key!, SCOPE)!;
    const effects = saved.effects ?? [];
    assert.strictEqual(effects.filter((effect) => effect.kind === "image_upload").length, 1);
    assert.strictEqual(effects.find((effect) => effect.effectId === "attachment-link")?.state, "committed");

    const remote = await handler.executeRemoteWrite(operation, preparedResult.prepared, context, deps);
    assert.strictEqual(remote.ok, true);
    assert.strictEqual(updateCommentCalls, 1);
    assert.strictEqual(updateIssueCalls, 1, "Primary remote writeからupdateIssueを再実行しないこと");
  });

  test("source変更後もfreeze済みspoolのbytesをuploadする", async () => {
    initializeOfflineSyncStore(createTestMemento(), `${SCOPE}freeze`);
    const scope = `${SCOPE}freeze`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-image-freeze-"));
    const imagePath = path.join(dir, "screen.jpg");
    fs.writeFileSync(imagePath, "content-A");
    const repo = createSyncOperationRepository();
    const body = "![image](./screen.jpg)";
    const operation = { ...createOperation(dir, body), connectionScope: scope, operationId: `${scope}:comment:10:20` };
    await repo.saveOperation(operation, scope);

    let uploadedBytes = "";
    const handler = new CommentUpdateHandler();
    const deps = {
      repository: repo,
      comment: {
        uploadFile: async (spoolPath: string) => {
          fs.writeFileSync(imagePath, "content-B");
          uploadedBytes = fs.readFileSync(spoolPath, "utf8");
          return { token: "jpg-token", filename: "screen.jpg", contentType: "image/jpeg" };
        },
        updateIssue: async () => {},
      },
    };
    const context = { connectionScope: scope };
    const preparedResult = await handler.prepare(operation, context, deps);
    assert.strictEqual(preparedResult.ok, true);
    if (!preparedResult.ok) {
      return;
    }
    const secondary = await handler.executeSecondaryEffects!(operation, preparedResult.prepared, context, deps);
    assert.strictEqual(secondary.ok, true);
    assert.strictEqual(uploadedBytes, "content-A");

    const effect = (repo.getOperation(operation.key!, scope)!.effects ?? [])
      .find((candidate) => candidate.kind === "image_upload");
    assert.strictEqual(effect?.requestSnapshot?.kind, "upload");
    if (effect?.requestSnapshot?.kind === "upload") {
      assert.strictEqual(effect.requestSnapshot.contentType, "image/jpeg");
      assert.ok(effect.requestSnapshot.spoolFilePath);
    }
  });

  test("attachment-linkのcommit checkpoint失敗はcommit_unknownで停止し、通常syncで再送しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), `${SCOPE}unknown`);
    const scope = `${SCOPE}unknown`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-image-unknown-"));
    fs.writeFileSync(path.join(dir, "screen.png"), "image");
    const operation = { ...createOperation(dir, "![image](./screen.png)"), connectionScope: scope, operationId: `${scope}:comment:10:20` };

    class LinkCommitCheckpointFailingRepository extends DefaultSyncOperationRepository {
      public override async transitionEffect(
        key: Parameters<DefaultSyncOperationRepository["transitionEffect"]>[0],
        effectId: string,
        action: DurableSyncEffectAction,
        scopeName: string,
        expected?: { operationRevision?: number; attemptGeneration?: number; sourceState: DurableSyncEffectState },
      ): Promise<UnifiedSyncOperation | undefined> {
        if (effectId === "attachment-link" && action.kind === "commit") {
          return undefined;
        }
        return super.transitionEffect(key, effectId, action, scopeName, expected);
      }
    }

    const repo = new LinkCommitCheckpointFailingRepository();
    await repo.saveOperation(operation, scope);
    let updateIssueCalls = 0;
    let updateCommentCalls = 0;
    const handler = new CommentUpdateHandler();
    const deps = {
      repository: repo,
      comment: {
        uploadFile: async () => ({ token: "image-token", filename: "screen.png", contentType: "image/png" }),
        updateIssue: async () => { updateIssueCalls++; },
        updateComment: async () => { updateCommentCalls++; },
      },
    };
    const context = { connectionScope: scope };
    const firstPrepared = await handler.prepare(operation, context, deps);
    assert.strictEqual(firstPrepared.ok, true);
    if (!firstPrepared.ok) {
      return;
    }
    const first = await handler.executeSecondaryEffects!(operation, firstPrepared.prepared, context, deps);
    assert.strictEqual(first.ok, false);
    assert.strictEqual(first.commitUnknown, true);
    assert.strictEqual(updateIssueCalls, 1);
    assert.strictEqual(updateCommentCalls, 0);
    assert.strictEqual(repo.getOperation(operation.key!, scope)?.effects?.find((effect) => effect.effectId === "attachment-link")?.state, "commit_unknown");

    const restored = repo.getOperation<CommentUpdateIntent>(operation.key!, scope)!;
    const secondPrepared = await handler.prepare(restored, context, deps);
    assert.strictEqual(secondPrepared.ok, true);
    if (!secondPrepared.ok) {
      return;
    }
    const second = await handler.executeSecondaryEffects!(restored, secondPrepared.prepared, context, deps);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(updateIssueCalls, 1, "commit_unknownを通常syncで盲目的に再送しないこと");
    assert.strictEqual(updateCommentCalls, 0);
  });
});
