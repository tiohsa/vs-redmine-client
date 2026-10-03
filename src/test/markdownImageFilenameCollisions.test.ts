import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  CommentCreateHandler, CommentUpdateHandler, TicketCreateHandler, TicketUpdateHandler,
  type OperationHandlerDeps, type PreparedCommentData, type PreparedTicketCreate, type PreparedTicketUpdate,
} from "../app/ticketSync/operationHandlers";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { DurableUploadSpoolStore } from "../app/ticketSync/uploadSpoolStore";
import type {
  CommentCreateIntent, CommentUpdateIntent, TicketCreateIntent, TicketUpdateIntent, UnifiedSyncOperation,
} from "../app/ticketSync/syncOperationTypes";
import type { DurableSyncEffect } from "../app/syncEffects";
import { extractMarkdownImageLinks } from "../utils/markdownImageLinks";
import { getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://markdown-filename.example.org";
const metadata = { tracker: "", priority: "", status: "", due_date: "", children: [] };

suite("Markdown画像のlogical filename衝突", () => {
  let root: string;
  let storage: vscode.Memento;
  setup(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "markdown-name-"));
    storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    for (const directory of ["first", "second"]) {
      await fs.promises.mkdir(path.join(root, directory));
      await fs.promises.writeFile(path.join(root, directory, "logo.png"), directory);
    }
    await fs.promises.writeFile(path.join(root, "unique.png"), "unique");
  });
  teardown(async () => {
    initializeOfflineSyncStore(createTestMemento());
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  for (const kind of ["ticket_create", "ticket_update", "comment_create", "comment_update"] as const) {
    const makeOperation = (body: string): UnifiedSyncOperation => ({
      operationId: `names-${kind}`, kind, phase: "preparing", revision: 1, intentRevision: 1,
      attemptGeneration: 1, persistenceVersion: 1, connectionScope: SCOPE,
      key: kind === "ticket_create" ? { kind: "newTicket", queueId: `names-${kind}` }
        : kind === "ticket_update" ? { kind: "ticket", ticketId: 10 }
          : { kind: "comment", ticketId: 10, ...(kind === "comment_update" ? { commentId: 20 } : { documentUri: "file:///new-comment.md" }) },
      ticketId: kind === "ticket_create" ? undefined : 10,
      commentId: kind === "comment_update" ? 20 : undefined,
      documentUri: kind === "comment_create" ? "file:///new-comment.md" : undefined,
      intent: kind === "ticket_create" ? { projectId: 1, subject: "Names", description: body, metadata }
        : kind === "ticket_update" ? { ticketId: 10, baseSubject: "Names", baseDescription: "", baseMetadata: metadata,
          subject: "Names", description: body, metadata }
          : { ticketId: 10, commentId: 20, body },
    });

    // Handlerを経由し、本文と送信DTOが保存済みSnapshotの名前を使うことを確認する。
    const execute = async (operation: UnifiedSyncOperation, body: string, deps: OperationHandlerDeps) => {
      const imageLinks = extractMarkdownImageLinks(body).map((link) => ({ ...link, resolvedPath: path.resolve(root, link.path) }));
      const context = { connectionScope: SCOPE };
      if (kind === "ticket_create") {
        const prepared: PreparedTicketCreate = { parsed: { subject: "Names", description: body, metadata },
          projectId: 1, uploadTokens: [], imageLinks };
        const result = await new TicketCreateHandler().executeSecondaryEffects(operation as UnifiedSyncOperation<TicketCreateIntent>, prepared, context, deps);
        return { result, body: prepared.parsed.description };
      }
      if (kind === "ticket_update") {
        const prepared: PreparedTicketUpdate = { ticketId: 10, changes: {}, uniqueChildren: [], imageLinks };
        const result = await new TicketUpdateHandler().executeSecondaryEffects(operation as UnifiedSyncOperation<TicketUpdateIntent>, prepared, context, deps);
        return { result, body: prepared.changes.description };
      }
      const prepared: PreparedCommentData = { ticketId: 10, commentId: 20, rawBody: body, body, uploads: [], imageLinks };
      const result = kind === "comment_create"
        ? await new CommentCreateHandler().executeSecondaryEffects(operation as UnifiedSyncOperation<CommentCreateIntent>, prepared, context, deps)
        : await new CommentUpdateHandler().executeSecondaryEffects(operation as UnifiedSyncOperation<CommentUpdateIntent>, prepared, context, deps);
      return { result, body: prepared.body };
    };

    test(`${kind}: 同名画像を区別しSnapshotの名前で本文を参照、restart後も再利用する`, async () => {
      const body = "![first](first/logo.png)\n![second](second/logo.png)\n![again](first/logo.png)\n![unique](unique.png)";
      const repo = createSyncOperationRepository();
      const operation = makeOperation(body);
      await repo.saveOperation(operation, SCOPE);
      let calls = 0;
      const uploadFile = async (filePath: string) => {
        calls++;
        const persisted = repo.getOperation(operation.key!, SCOPE)!;
        const effect = persisted.effects!.find((entry) => entry.requestSnapshot?.kind === "upload" && entry.requestSnapshot.spoolFilePath === filePath)!;
        assert.strictEqual(effect.state, "started", "remote upload前にSnapshotが永続化される");
        return { token: `token-${fs.readFileSync(filePath, "utf8")}`, filename: path.basename(filePath), contentType: "transport/type" };
      };
      const store = new DurableUploadSpoolStore(root);
      const deps = { repository: repo, uploadSpoolStore: store, ticketCreate: { uploadFile }, ticketUpdate: { uploadFile },
        comment: { uploadFile, updateIssue: async () => undefined } };
      const first = await execute(operation, body, deps);
      assert.ok(first.result.ok, !first.result.ok ? first.result.error.message : "");
      const uploads = first.result.uploadTokens!;
      assert.strictEqual(calls, 3);
      assert.strictEqual(new Set(uploads.map((upload) => upload.filename)).size, 3);
      const firstName = uploads.find((upload) => upload.token === "token-first")!.filename;
      const secondName = uploads.find((upload) => upload.token === "token-second")!.filename;
      assert.notStrictEqual(firstName, secondName);
      assert.strictEqual(uploads.find((upload) => upload.token === "token-unique")!.filename, "unique.png");
      assert.strictEqual(first.body, `![first](${firstName})\n![second](${secondName})\n![again](${firstName})\n![unique](unique.png)`);
      for (const effect of repo.getOperation(operation.key!, SCOPE)!.effects!.filter((entry) => entry.kind === "image_upload")) {
        assert.ok(effect.requestSnapshot?.kind === "upload");
        const upload = uploads.find((entry) => entry.token === effect.token)!;
        assert.strictEqual(effect.requestSnapshot.filename, upload.filename);
        assert.strictEqual(effect.target.filename, upload.filename);
        assert.strictEqual(effect.requestSnapshot.contentType, "image/png");
      }
      initializeOfflineSyncStore(storage, SCOPE);
      const restoredRepo = createSyncOperationRepository();
      const restored = restoredRepo.getOperation(operation.key!, SCOPE)!;
      const reused = await execute(restored, body, { ...deps, repository: restoredRepo,
        ticketCreate: { uploadFile: async () => { throw new Error("unexpected upload"); } },
        ticketUpdate: { uploadFile: async () => { throw new Error("unexpected upload"); } },
        comment: { ...deps.comment, uploadFile: async () => { throw new Error("unexpected upload"); } } });
      assert.ok(reused.result.ok, !reused.result.ok ? reused.result.error.message : "");
      assert.strictEqual(reused.body, first.body);
      assert.deepStrictEqual(reused.result.uploadTokens, uploads);
    });

    test(`${kind}: 旧committed画像を既存のlogical filenameで再利用する`, async () => {
      const body = "![](first/logo.png)\n![](second/logo.png)";
      const operation = makeOperation(body);
      operation.effects = ["first", "second"].map((directory): DurableSyncEffect => ({
        effectId: `image:markdown:${path.join(root, directory, "logo.png")}`, kind: "image_upload",
        operationRevision: 1, attemptGeneration: 1, state: "committed", token: `old-${directory}`,
        target: { filePath: path.join(root, directory, "logo.png"), filename: `old-${directory}-logo.png` },
        requestSnapshot: { kind: "upload", filePath: path.join(root, directory, "logo.png"), filename: "logo.png",
          contentType: "image/png", contentHash: directory, contentSize: directory.length },
      }));
      const repo = createSyncOperationRepository();
      await repo.saveOperation(operation, SCOPE);
      if (kind === "comment_update") {
        operation.effects!.push({ effectId: "attachment-link", kind: "attachment_link", operationRevision: 1,
          attemptGeneration: 1, state: "committed", target: { ticketId: 10 },
          requestSnapshot: { kind: "attachment_link", request: { issueId: 10, fields: { uploads: [
            { token: "old-first", filename: "old-first-logo.png", content_type: "image/png" },
            { token: "old-second", filename: "old-second-logo.png", content_type: "image/png" },
          ] } } } });
        await repo.saveOperation(operation, SCOPE);
      }
      const before = repo.getOperation(operation.key!, SCOPE)!;
      const beforeQueue = getOfflineSyncQueue(SCOPE);
      const originalUpdate = storage.update;
      let persistenceWrites = 0;
      storage.update = (...args: Parameters<vscode.Memento["update"]>) => {
        persistenceWrites++;
        return originalUpdate.apply(storage, args);
      };
      let calls = 0;
      const uploadFile = async () => { calls++; return { token: "unexpected", filename: "unique.png", contentType: "image/png" }; };
      try {
        const resumed = await execute(before, body, { repository: repo, uploadSpoolStore: new DurableUploadSpoolStore(root),
          ticketCreate: { uploadFile }, ticketUpdate: { uploadFile }, comment: { uploadFile, updateIssue: async () => { calls++; } } });
        assert.ok(resumed.result.ok, !resumed.result.ok ? resumed.result.error.message : "");
        assert.strictEqual(resumed.body, "![](old-first-logo.png)\n![](old-second-logo.png)");
        assert.deepStrictEqual(resumed.result.uploadTokens, [
          { token: "old-first", filename: "old-first-logo.png", content_type: "image/png" },
          { token: "old-second", filename: "old-second-logo.png", content_type: "image/png" },
        ]);
        assert.strictEqual(calls, 0);
        assert.strictEqual(persistenceWrites, 0);
        // 旧commentのcreatedAt欠落時はgetOperationがDate.now()で補完するため、永続状態で比較する。
        const after = repo.getOperation(operation.key!, SCOPE)!;
        assert.deepStrictEqual(after.effects, before.effects);
        assert.strictEqual(after.phase, before.phase);
        assert.deepStrictEqual(getOfflineSyncQueue(SCOPE), beforeQueue);
      } finally {
        storage.update = originalUpdate;
      }
    });

    for (const snapshot of [false, true]) {
      test(`${kind}: ${snapshot ? "Snapshot" : "旧committed target"}の名前を予約し、新しい画像だけ改名する`, async () => {
        const body = "![](first/logo.png)\n![](unique.png)";
        const operation = makeOperation(body);
        const filePath = path.join(root, "first/logo.png");
        operation.effects = [{ effectId: `image:markdown:${filePath}`, kind: "image_upload", operationRevision: 1,
          attemptGeneration: 1, state: "committed", token: "old-token", target: { filePath, filename: "unique.png" },
          ...(snapshot ? { requestSnapshot: { kind: "upload" as const, filePath, filename: "unique.png", contentType: "saved/type",
            contentHash: "old-content", contentSize: 5 } } : {}) }];
        const repo = createSyncOperationRepository();
        await repo.saveOperation(operation, SCOPE);
        const uploadFile = async () => ({ token: "new-token", filename: "transport.png", contentType: "transport/type" });
        const result = await execute(operation, body, { repository: repo, uploadSpoolStore: new DurableUploadSpoolStore(root),
          ticketCreate: { uploadFile }, ticketUpdate: { uploadFile }, comment: { uploadFile, updateIssue: async () => undefined } });
        assert.ok(result.result.ok);
        const uploads = result.result.uploadTokens!;
        const old = uploads.find((entry) => entry.token === "old-token")!;
        const added = uploads.find((entry) => entry.token === "new-token")!;
        assert.strictEqual(old.filename, "unique.png");
        assert.strictEqual(old.content_type, snapshot ? "saved/type" : "image/png");
        assert.notStrictEqual(added.filename, "unique.png");
        assert.strictEqual(result.body, `![](unique.png)\n![](${added.filename})`);
        assert.deepStrictEqual(repo.getOperation(operation.key!, SCOPE)!.effects!.find((entry) => entry.effectId === operation.effects![0].effectId), operation.effects![0]);
      });
    }

    for (const extension of [".png", ".jpeg"]) {
      test(`${kind}: 255文字の画像名は拡張子を保ち入力順によらず衝突解決する (${extension})`, async () => {
        const basename = `${"x".repeat(255 - extension.length)}${extension}`;
        for (const directory of ["first", "second"]) {
          await fs.promises.writeFile(path.join(root, directory, basename), directory);
        }
        const firstPath = path.join(root, "first", basename);
        const hash = crypto.createHash("sha256").update(path.normalize(firstPath)).digest("hex");
        const naturalName = `${"x".repeat(255 - extension.length - 13)}-${hash.slice(0, 12)}${extension}`;
        await fs.promises.writeFile(path.join(root, naturalName), "natural");
        const paths = [`first/${basename}`, `second/${basename}`, naturalName];
        const run = async (links: string[]) => {
          initializeOfflineSyncStore(createTestMemento(), SCOPE);
          const body = links.map((link) => `![](${link})`).join("\n");
          const operation = makeOperation(body);
          const repo = createSyncOperationRepository();
          await repo.saveOperation(operation, SCOPE);
          const uploadFile = async (filePath: string) => ({ token: fs.readFileSync(filePath, "utf8"),
            filename: "transport.png", contentType: "transport/type" });
          const result = await execute(operation, body, { repository: repo, uploadSpoolStore: new DurableUploadSpoolStore(root),
            ticketCreate: { uploadFile }, ticketUpdate: { uploadFile }, comment: { uploadFile, updateIssue: async () => undefined } });
          assert.ok(result.result.ok, !result.result.ok ? result.result.error.message : "");
          const uploads = result.result.uploadTokens!;
          assert.strictEqual(new Set(uploads.map((entry) => entry.filename)).size, 3);
          assert.strictEqual(uploads.find((entry) => entry.token === "natural")!.filename, naturalName);
          assert.ok(uploads.find((entry) => entry.token === "first")!.filename.endsWith(`-${hash.slice(0, 16)}${extension}`));
          for (const entry of uploads) {
            assert.ok(entry.filename.length <= 255);
            assert.ok(entry.filename.endsWith(extension));
            assert.ok(result.body!.includes(`![](${entry.filename})`));
          }
          return Object.fromEntries(uploads.map((entry) => [entry.token, entry.filename]));
        };
        assert.deepStrictEqual(await run(paths), await run([...paths].reverse()));
      });
    }

    test(`${kind}: 生成候補と衝突しない画像名の競合では識別子を延ばす`, async () => {
      const hash = crypto.createHash("sha256").update(path.normalize(path.join(root, "first/logo.png"))).digest("hex");
      const naturalName = `logo-${hash.slice(0, 12)}.png`;
      await fs.promises.writeFile(path.join(root, naturalName), "natural");
      const body = `![](first/logo.png)\n![](second/logo.png)\n![](${naturalName})`;
      const operation = makeOperation(body);
      const repo = createSyncOperationRepository();
      await repo.saveOperation(operation, SCOPE);
      const uploadFile = async (filePath: string) => ({ token: fs.readFileSync(filePath, "utf8"), filename: "transport.png", contentType: "transport/type" });
      const result = await execute(operation, body, { repository: repo, uploadSpoolStore: new DurableUploadSpoolStore(root),
        ticketCreate: { uploadFile }, ticketUpdate: { uploadFile }, comment: { uploadFile, updateIssue: async () => undefined } });
      assert.ok(result.result.ok);
      const uploads = result.result.uploadTokens!;
      assert.strictEqual(uploads.find((entry) => entry.token === "natural")!.filename, naturalName);
      assert.strictEqual(new Set(uploads.map((entry) => entry.filename)).size, 3);
      assert.notStrictEqual(uploads.find((entry) => entry.token === "first")!.filename, naturalName);
    });
  }
});
