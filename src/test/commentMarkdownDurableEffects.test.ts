import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommentCreateHandler, CommentUpdateHandler } from "../app/ticketSync/operationHandlers";
import { createSyncOperationRepository, DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import type { DurableSyncEffect, DurableSyncEffectAction, DurableSyncEffectState } from "../app/syncEffects";
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

const legacyEffectStates = ["planned", "committed", "commit_unknown", "failed"] as const;
type LegacyEffectState = (typeof legacyEffectStates)[number];

const createLegacyMarkdownImageEffect = (
  filePath: string,
  state: LegacyEffectState,
  ordinal = 0,
  token = "legacy-token",
): DurableSyncEffect => ({
  effectId: `image:markdown:${ordinal}:${filePath}`,
  kind: "image_upload",
  operationRevision: 1,
  attemptGeneration: 1,
  state,
  target: { filePath, filename: path.basename(filePath) },
  ...(state === "committed" ? { token } : {}),
  ...(state === "failed" ? { failure: { disposition: "non_retriable", detail: "legacy failure" } } : {}),
});

const withLegacyMarkdownImageEffect = <T extends CommentCreateIntent | CommentUpdateIntent>(
  operation: UnifiedSyncOperation<T>,
  effect: DurableSyncEffect,
): UnifiedSyncOperation<T> => ({
  ...operation,
  effects: [effect],
});

const withLegacyMarkdownImageEffects = <T extends CommentCreateIntent | CommentUpdateIntent>(
  operation: UnifiedSyncOperation<T>,
  effects: DurableSyncEffect[],
): UnifiedSyncOperation<T> => ({
  ...operation,
  effects,
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
    const imageEffects = (repo.getOperation(operation.key!, scope)?.effects ?? [])
      .filter((effect) => effect.kind === "image_upload");
    assert.strictEqual(imageEffects.length, 1);
    assert.strictEqual(imageEffects[0].effectId, `image:markdown:${path.join(dir, "screen.png")}`);
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

  for (const state of legacyEffectStates) {
    test(`Comment Create の legacy ${state} Effect ID を継続利用する`, async () => {
      const scope = `${SCOPE}legacy-create-${state}`;
      initializeOfflineSyncStore(createTestMemento(), scope);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `comment-legacy-create-${state}-`));
      const imagePath = path.join(dir, "screen.png");
      fs.writeFileSync(imagePath, "image");
      const body = "![image](./screen.png)";
      const operation = withLegacyMarkdownImageEffect(
        { ...createCommentOperation(dir, body), connectionScope: scope, operationId: `${scope}:comment-create:10` },
        createLegacyMarkdownImageEffect(imagePath, state),
      );
      const repo = createSyncOperationRepository();
      await repo.saveOperation(operation, scope);

      let uploadCalls = 0;
      const handler = new CommentCreateHandler();
      const context = { connectionScope: scope };
      const preparedResult = await handler.prepare(operation, context, { repository: repo });
      assert.strictEqual(preparedResult.ok, true);
      if (!preparedResult.ok) {
        return;
      }
      const secondary = await handler.executeSecondaryEffects!(operation, preparedResult.prepared, context, {
        repository: repo,
        comment: {
          uploadFile: async () => {
            uploadCalls++;
            return { token: "new-token", filename: "screen.png", contentType: "image/png" };
          },
        },
      });

      const savedEffects = repo.getOperation(operation.key!, scope)?.effects ?? [];
      assert.strictEqual(savedEffects.some((effect) => effect.effectId === `image:markdown:${imagePath}`), false);
      const savedLegacyEffect = savedEffects.find((effect) => effect.effectId === `image:markdown:0:${imagePath}`);
      assert.ok(savedLegacyEffect);
      if (state === "planned") {
        assert.strictEqual(secondary.ok, true);
        assert.strictEqual(uploadCalls, 1);
      } else if (state === "committed") {
        assert.strictEqual(secondary.ok, true);
        assert.strictEqual(uploadCalls, 0);
        assert.strictEqual(savedLegacyEffect?.token, "legacy-token");
      } else {
        assert.strictEqual(secondary.ok, false);
        assert.strictEqual(uploadCalls, 0);
        assert.strictEqual(secondary.commitUnknown, state === "commit_unknown");
      }
    });

    test(`Comment Update の legacy ${state} Effect ID を継続利用する`, async () => {
      const scope = `${SCOPE}legacy-update-${state}`;
      initializeOfflineSyncStore(createTestMemento(), scope);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `comment-legacy-update-${state}-`));
      const imagePath = path.join(dir, "screen.png");
      fs.writeFileSync(imagePath, "image");
      const body = "![image](./screen.png)";
      const operation = withLegacyMarkdownImageEffect(
        { ...createOperation(dir, body), connectionScope: scope, operationId: `${scope}:comment:10:20` },
        createLegacyMarkdownImageEffect(imagePath, state),
      );
      const repo = createSyncOperationRepository();
      await repo.saveOperation(operation, scope);

      let uploadCalls = 0;
      const handler = new CommentUpdateHandler();
      const context = { connectionScope: scope };
      const preparedResult = await handler.prepare(operation, context, { repository: repo });
      assert.strictEqual(preparedResult.ok, true);
      if (!preparedResult.ok) {
        return;
      }
      const secondary = await handler.executeSecondaryEffects!(operation, preparedResult.prepared, context, {
        repository: repo,
        comment: {
          uploadFile: async () => {
            uploadCalls++;
            return { token: "new-token", filename: "screen.png", contentType: "image/png" };
          },
          updateIssue: async () => {},
        },
      });

      const savedEffects = repo.getOperation(operation.key!, scope)?.effects ?? [];
      assert.strictEqual(savedEffects.some((effect) => effect.effectId === `image:markdown:${imagePath}`), false);
      const savedLegacyEffect = savedEffects.find((effect) => effect.effectId === `image:markdown:0:${imagePath}`);
      assert.ok(savedLegacyEffect);
      if (state === "planned") {
        assert.strictEqual(secondary.ok, true);
        assert.strictEqual(uploadCalls, 1);
      } else if (state === "committed") {
        assert.strictEqual(secondary.ok, true);
        assert.strictEqual(uploadCalls, 0);
        assert.strictEqual(savedLegacyEffect?.token, "legacy-token");
      } else {
        assert.strictEqual(secondary.ok, false);
        assert.strictEqual(uploadCalls, 0);
        assert.strictEqual(secondary.commitUnknown, state === "commit_unknown");
      }
    });
  }

  const multipleLegacyEffectCases: Array<{
    name: string;
    states: readonly [LegacyEffectState, LegacyEffectState];
    expectedOk: boolean;
    expectedCommitUnknown: boolean;
  }> = [
    {
      name: "committed + commit_unknown",
      states: ["committed", "commit_unknown"],
      expectedOk: false,
      expectedCommitUnknown: true,
    },
    {
      name: "committed + failed/non_retriable",
      states: ["committed", "failed"],
      expectedOk: false,
      expectedCommitUnknown: false,
    },
    {
      name: "planned + commit_unknown",
      states: ["planned", "commit_unknown"],
      expectedOk: false,
      expectedCommitUnknown: true,
    },
    {
      name: "複数 committed",
      states: ["committed", "committed"],
      expectedOk: true,
      expectedCommitUnknown: false,
    },
  ];

  for (const operationKind of ["create", "update"] as const) {
    for (const testCase of multipleLegacyEffectCases) {
      test(`Comment ${operationKind === "create" ? "Create" : "Update"} は同一 filePath の ${testCase.name} を全件評価する`, async () => {
        const scope = `${SCOPE}multiple-legacy-${operationKind}-${testCase.name}`;
        initializeOfflineSyncStore(createTestMemento(), scope);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `comment-multiple-legacy-${operationKind}-`));
        const imagePath = path.join(dir, "screen.png");
        fs.writeFileSync(imagePath, "image");
        const body = "![image](./screen.png)";
        const baseOperation = operationKind === "create"
          ? createCommentOperation(dir, body)
          : createOperation(dir, body);
        const operation = withLegacyMarkdownImageEffects(
          {
            ...baseOperation,
            connectionScope: scope,
            operationId: `${scope}:comment-${operationKind}:10`,
          },
          testCase.states.map((state, ordinal) =>
            createLegacyMarkdownImageEffect(imagePath, state, ordinal, `legacy-token-${ordinal}`),
          ),
        );
        const repo = createSyncOperationRepository();
        await repo.saveOperation(operation, scope);

        let uploadCalls = 0;
        const handler = operationKind === "create"
          ? new CommentCreateHandler()
          : new CommentUpdateHandler();
        const context = { connectionScope: scope };
        const preparedResult = await handler.prepare(operation as never, context, { repository: repo });
        assert.strictEqual(preparedResult.ok, true);
        if (!preparedResult.ok) {
          return;
        }
        const secondary = await handler.executeSecondaryEffects!(
          operation as never,
          preparedResult.prepared,
          context,
          {
            repository: repo,
            comment: {
              uploadFile: async () => {
                uploadCalls++;
                return { token: "new-token", filename: "screen.png", contentType: "image/png" };
              },
              updateIssue: async () => {},
            },
          },
        );

        assert.strictEqual(secondary.ok, testCase.expectedOk);
        assert.strictEqual(uploadCalls, 0);
        if (!secondary.ok) {
          assert.strictEqual(secondary.commitUnknown ?? false, testCase.expectedCommitUnknown);
        } else {
          assert.strictEqual(secondary.uploadTokens?.[0]?.token, "legacy-token-0");
        }
        const savedEffects = repo.getOperation(operation.key!, scope)?.effects ?? [];
        assert.strictEqual(
          savedEffects.some((effect) => effect.effectId === `image:markdown:${imagePath}`),
          false,
        );
        assert.strictEqual(savedEffects.length, 2);
      });
    }
  }
});
