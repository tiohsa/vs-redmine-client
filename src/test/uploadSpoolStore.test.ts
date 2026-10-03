import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { DurableUploadSpoolStore, resolveUploadSpoolOwner } from "../app/ticketSync/uploadSpoolStore";
import type { FrozenUpload } from "../app/ticketSync/ports";
import type { UploadRequestSnapshot } from "../app/syncEffects";
import { getConnectionScopeHash } from "../config/connectionScope";
import { computeBufferHashAndSize } from "../utils/fileHash";
import { getPersistedUploadSpoolReferences, initializeOfflineSyncStore, getOfflineSyncQueue, getActiveScope } from "../views/offlineSyncStore";
import type { Memento } from "vscode";
import { observeUploadSpoolCleanup } from "../app/ticketSync/uploadSpoolCleanup";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import type { OperationHandler } from "../app/ticketSync/operationHandlers";
import type { TicketCreateIntent, UnifiedSyncOperation } from "../app/ticketSync/syncOperationTypes";

const scope = "https://redmine.example.test/project";
const bytes = Buffer.from("authoritative frozen bytes");
const snapshot = (frozen: FrozenUpload): UploadRequestSnapshot => ({
  kind: "upload", filename: "image.png", contentType: "image/png",
  spoolFilePath: frozen.spoolFilePath, contentHash: frozen.contentHash, contentSize: frozen.contentSize,
});

suite("Durable upload spool store", () => {
  let root: string;
  let store: DurableUploadSpoolStore;
  const freeze = () => store.freezeBuffer({ connectionScope: scope, buffer: bytes,
    filename: "image.png", contentType: "image/png" });

  setup(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "upload-spool-test-"));
    store = new DurableUploadSpoolStore(root);
  });
  teardown(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });

  test("SP-01: freezes file bytes under extension storage and scope hash", async () => {
    const source = path.join(root, "source.png");
    await fs.promises.writeFile(source, bytes);
    const frozen = await store.freezeFile({ connectionScope: scope, sourcePath: source, filename: "image.png" });
    assert.strictEqual(path.dirname(frozen.spoolFilePath), path.join(root, "sync-spool", getConnectionScopeHash(scope)));
    assert.deepStrictEqual({ contentHash: frozen.contentHash, contentSize: frozen.contentSize }, computeBufferHashAndSize(bytes));
    assert.deepStrictEqual(await fs.promises.readFile(frozen.spoolFilePath), bytes);
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    frozen.release();
  });

  test("SP-01: scope isolation and filename traversal cannot escape storage", async () => {
    const first = await freeze();
    const second = await store.freezeBuffer({ connectionScope: "https://other.example.test", buffer: bytes,
      filename: "../../image.png", contentType: "image/png" });
    assert.notStrictEqual(path.dirname(first.spoolFilePath), path.dirname(second.spoolFilePath));
    assert.strictEqual(path.dirname(second.spoolFilePath), path.join(root, "sync-spool", getConnectionScopeHash("https://other.example.test")));
    first.release(); second.release();
  });

  test("S-13 / SP-02: existing matching spool is verified without overwriting it", async () => {
    const first = await freeze();
    const before = await fs.promises.stat(first.spoolFilePath);
    const second = await freeze();
    const after = await fs.promises.stat(second.spoolFilePath);
    assert.strictEqual(first.spoolFilePath, second.spoolFilePath);
    assert.strictEqual(before.ino, after.ino);
    assert.strictEqual(before.mtimeMs, after.mtimeMs);
    first.release(); second.release();
  });

  test("S-11 / S-12: partial write は final を公開せず temp を片付け、その後 refreeze できる", async () => {
    const originalOpen = fs.promises.open;
    fs.promises.open = async (...args: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...args);
      if (args[1] === "wx") {
        handle.writeFile = async () => {
          await handle.write(bytes.subarray(0, 3));
          throw new Error("injected partial write failure");
        };
      }
      return handle;
    };
    try { await assert.rejects(freeze(), /injected partial write failure/); }
    finally { fs.promises.open = originalOpen; }
    const directory = path.join(root, "sync-spool", getConnectionScopeHash(scope));
    assert.deepStrictEqual(await fs.promises.readdir(directory), [], "partial final / temp を残さない");
    const frozen = await freeze();
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    frozen.release();
  });

  test("long source filenames leave room for storage ownership within NAME_MAX", async () => {
    const frozen = await store.freezeBuffer({ connectionScope: scope, buffer: bytes,
      filename: `${"image".repeat(40)}.png`, contentType: "image/png" });
    assert.ok(Buffer.byteLength(path.basename(frozen.spoolFilePath)) <= 255);
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    frozen.release();
  });

  test("shared global storage isolates cleanup ownership across workspaces", async () => {
    const workspaceA = new DurableUploadSpoolStore(root, "workspace-A");
    const workspaceB = new DurableUploadSpoolStore(root, "workspace-B");
    const input = { connectionScope: scope, buffer: bytes, filename: "image.png", contentType: "image/png" };
    const first = await workspaceA.freezeBuffer(input);
    const second = await workspaceB.freezeBuffer(input);
    assert.notStrictEqual(first.spoolFilePath, second.spoolFilePath);
    assert.strictEqual(path.dirname(first.spoolFilePath), path.dirname(second.spoolFilePath));
    first.release(); second.release();
    await workspaceA.cleanupUnreferenced(() => new Set());
    assert.strictEqual(fs.existsSync(first.spoolFilePath), false);
    assert.strictEqual(await workspaceB.verify(snapshot(second)), true);
    await workspaceB.cleanupUnreferenced(() => new Set());
    assert.strictEqual(fs.existsSync(second.spoolFilePath), false);
  });

  test("same-workspace stores share freeze serialization and active leases", async () => {
    const peer = new DurableUploadSpoolStore(root);
    const freezing = freeze();
    const cleaning = peer.cleanupUnreferenced(() => new Set());
    const frozen = await freezing;
    await cleaning;
    assert.strictEqual(await peer.verify(snapshot(frozen)), true);
    frozen.release();
    await peer.cleanupUnreferenced(() => new Set());
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
  });

  test("another live writer protects unpersisted bytes until its process exits", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const stopped = new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
    try {
      assert.ok(child.pid);
      const frozen = await freeze();
      frozen.release();
      const foreignPath = frozen.spoolFilePath.replace(
        /(^.*[a-f0-9]{64}-[a-f0-9]{16}-)\d+-/,
        (_match, prefix: string) => `${prefix}${child.pid}-`,
      );
      assert.notStrictEqual(foreignPath, frozen.spoolFilePath);
      await fs.promises.rename(frozen.spoolFilePath, foreignPath);
      await store.cleanupUnreferenced(() => new Set());
      assert.deepStrictEqual(await fs.promises.readFile(foreignPath), bytes);
      child.kill();
      await stopped;
      const references = new Set([foreignPath]);
      await store.cleanupUnreferenced(() => references);
      assert.strictEqual(fs.existsSync(foreignPath), true);
      references.clear();
      await store.cleanupUnreferenced(() => references);
      assert.strictEqual(fs.existsSync(foreignPath), false);
    } finally {
      child.kill();
      await stopped;
    }
  });

  test("S-14 / SP-03: tampered existing spool fails closed and is not overwritten", async () => {
    const frozen = await freeze();
    const corrupted = Buffer.alloc(bytes.length, 120);
    await fs.promises.writeFile(frozen.spoolFilePath, corrupted);
    assert.strictEqual(await store.verify(snapshot(frozen)), false);
    await assert.rejects(freeze(), /identity mismatch/);
    assert.deepStrictEqual(await fs.promises.readFile(frozen.spoolFilePath), corrupted);
    frozen.release();
  });

  test("freezeFile rejects a changed source against the expected identity", async () => {
    const source = path.join(root, "source.png");
    await fs.promises.writeFile(source, "different bytes");
    await assert.rejects(store.freezeFile({ connectionScope: scope, sourcePath: source,
      filename: "image.png", expected: computeBufferHashAndSize(bytes) }), /changed/);
  });

  test("streaming freezeFile は readFile を使わず、大きい source を検証して同じ final を再利用する", async () => {
    const source = path.join(root, "large.bin");
    const content = Buffer.alloc(2 * 1024 * 1024 + 7, 37);
    await fs.promises.writeFile(source, content);
    const originalReadFile = fs.promises.readFile;
    fs.promises.readFile = async () => { throw new Error("whole-file read is forbidden"); };
    try {
      const first = await store.freezeFile({ connectionScope: scope, sourcePath: source, filename: "large.bin",
        expected: computeBufferHashAndSize(content) });
      const before = await fs.promises.stat(first.spoolFilePath);
      const second = await store.freezeFile({ connectionScope: scope, sourcePath: source, filename: "large.bin" });
      assert.strictEqual(second.spoolFilePath, first.spoolFilePath);
      assert.strictEqual((await fs.promises.stat(second.spoolFilePath)).ino, before.ino);
      assert.strictEqual(await store.verify({ ...snapshot(first), ...computeBufferHashAndSize(content) }), true);
      first.release(); second.release();
    } finally { fs.promises.readFile = originalReadFile; }
  });

  test("buffer mutation after freeze starts cannot change frozen bytes", async () => {
    const input = Buffer.from(bytes);
    const pending = store.freezeBuffer({ connectionScope: scope, buffer: input, filename: "image.png", contentType: "image/png" });
    input.fill(120);
    const frozen = await pending;
    assert.deepStrictEqual(await fs.promises.readFile(frozen.spoolFilePath), bytes);
    frozen.release();
  });

  test("active leases protect bytes until the last release and release is idempotent", async () => {
    const first = await freeze();
    const second = await freeze();
    first.release(); first.release();
    await store.cleanupUnreferenced(() => new Set());
    assert.strictEqual(await store.verify(snapshot(second)), true);
    second.release();
    await store.cleanupUnreferenced(() => new Set());
    assert.strictEqual(fs.existsSync(second.spoolFilePath), false);
  });

  test("freeze and cleanup races protect a new lease and safely refreeze removed bytes", async () => {
    const pending = freeze();
    const cleanup = store.cleanupUnreferenced(() => new Set());
    const first = await pending;
    await cleanup;
    assert.strictEqual(await store.verify(snapshot(first)), true);
    first.release();
    const removing = store.cleanupUnreferenced(() => new Set());
    const refreezing = freeze();
    await removing;
    const second = await refreezing;
    assert.strictEqual(await store.verify(snapshot(second)), true);
    second.release();
  });

  test("cleanup consults fresh references after a preceding freeze", async () => {
    const frozen = await freeze();
    const references = new Set<string>();
    const cleanup = store.cleanupUnreferenced(() => references);
    references.add(frozen.spoolFilePath);
    frozen.release();
    await cleanup;
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    references.clear();
    await store.cleanupUnreferenced(() => references);
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
  });

  test("G-01: 複数candidateのcleanupでもreferencesをpassにつき一度だけ取得する", async () => {
    const first = await freeze();
    const second = await store.freezeBuffer({ connectionScope: scope, buffer: Buffer.from("other bytes"),
      filename: "other.png", contentType: "image/png" });
    first.release(); second.release();
    let calls = 0;
    await store.cleanupUnreferenced(() => { calls++; return new Set([second.spoolFilePath]); });
    assert.strictEqual(calls, 1);
    assert.strictEqual(fs.existsSync(first.spoolFilePath), false);
    assert.strictEqual(fs.existsSync(second.spoolFilePath), true);
  });

  test("G-03: references取得後に永続化してreleaseされた開始時leaseを保護する", async () => {
    const frozen = await freeze();
    const persisted = new Set<string>();
    let calls = 0;
    await store.cleanupUnreferenced(() => {
      calls++;
      const beforePersistence = new Set(persisted);
      // reference snapshot と directory scan の間で queue 永続化が完了する。
      queueMicrotask(() => { persisted.add(frozen.spoolFilePath); frozen.release(); });
      return beforePersistence;
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    await store.cleanupUnreferenced(() => persisted);
    assert.strictEqual(await store.verify(snapshot(frozen)), true);
    persisted.clear();
    await store.cleanupUnreferenced(() => persisted);
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
  });

  test("G-02: running中の10件queue変更をcurrent + 1 follow-upへcoalesceする", async () => {
    const storage = memoryStorage();
    initializeOfflineSyncStore(storage, scope);
    let calls = 0;
    let start: () => void = () => undefined;
    let finish: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const originalCleanup = store.cleanupUnreferenced.bind(store);
    store.cleanupUnreferenced = async (references) => {
      calls++;
      if (calls === 1) { start(); await gate; }
      await originalCleanup(references);
    };
    const observer = observeUploadSpoolCleanup({ store, storage });
    try {
      const current = observer.cleanup();
      await started;
      const repository = createSyncOperationRepository();
      for (let index = 0; index < 10; index++) {
        await repository.saveOperation({ operationId: `cleanup-${index}`, kind: "ticket_create",
          key: { kind: "newTicket", queueId: `cleanup-${index}` }, connectionScope: scope,
          phase: "queued", revision: 1, persistenceVersion: 1,
          intent: { projectId: 1, subject: "Coalesce", description: "",
            metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] } } }, scope);
      }
      assert.strictEqual(calls, 1);
      const joined = observer.cleanup();
      assert.strictEqual(joined, current);
      finish();
      await current;
      assert.strictEqual(calls, 2);
      observer.dispose();
      await observer.cleanup();
      assert.strictEqual(calls, 2);
    } finally {
      finish(); observer.dispose();
      initializeOfflineSyncStore(memoryStorage());
    }
  });

  test("SP-10: legacy temporary spool verifies unchanged and is outside cleanup ownership", async () => {
    const legacyRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "legacy-upload-test-"));
    try {
      const legacyPath = path.join(legacyRoot, "vs-redmine-spool", "image.png");
      await fs.promises.mkdir(path.dirname(legacyPath));
      await fs.promises.writeFile(legacyPath, bytes);
      const legacy: UploadRequestSnapshot = { kind: "upload", filename: "image.png", contentType: "image/png",
        spoolFilePath: legacyPath, ...computeBufferHashAndSize(bytes) };
      assert.strictEqual(await store.verify(legacy), true);
      await store.cleanupUnreferenced(() => new Set());
      assert.strictEqual(legacy.spoolFilePath, legacyPath);
      assert.deepStrictEqual(await fs.promises.readFile(legacyPath), bytes);
      await fs.promises.unlink(legacyPath);
      assert.strictEqual(await store.verify(legacy), false);
    } finally { await fs.promises.rm(legacyRoot, { recursive: true, force: true }); }
  });

  const memoryStorage = (): Memento => {
    const values = new Map<string, unknown>();
    return {
      keys: () => Array.from(values.keys()),
      get: <T>(key: string, fallback?: T): T => values.has(key) ? values.get(key) as T : fallback as T,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) { values.delete(key); }
        else { values.set(key, structuredClone(value)); }
      },
    };
  };
  test("empty-window spool ownership survives reinitialization and permits final cleanup", async () => {
    const storage = memoryStorage();
    const firstOwner = await resolveUploadSpoolOwner(storage, undefined);
    const initial = new DurableUploadSpoolStore(root, firstOwner);
    const frozen = await initial.freezeBuffer({ connectionScope: scope, buffer: bytes,
      filename: "image.png", contentType: "image/png" });
    frozen.release();
    const restartedOwner = await resolveUploadSpoolOwner(storage, undefined);
    assert.strictEqual(restartedOwner, firstOwner);
    const restarted = new DurableUploadSpoolStore(root, restartedOwner);
    await restarted.cleanupUnreferenced(() => new Set());
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
    assert.strictEqual(await resolveUploadSpoolOwner(storage, "workspace-storage-uri"), "workspace-storage-uri");
  });

  const storageKey = (connectionScope: string): string => `redmine.offlineSyncQueue.${encodeURIComponent(connectionScope)}`;

  for (const lifecycle of ["commit_unknown", "abandoned"] as const) {
    test(`${lifecycle === "commit_unknown" ? "SP-06" : "SP-07"}: persisted ${lifecycle} reference survives cleanup and restart`, async () => {
      const frozen = await freeze();
      const storage = memoryStorage();
      const record = { version: 3, operations: [{ kind: "ticketUpdate", payload: {
        phase: lifecycle === "commit_unknown" ? "commit_unknown" : "remote_write_started",
        ...(lifecycle === "abandoned" ? { abandonedAt: "2026-10-03T00:00:00Z" } : {}),
        revision: 2, attemptGeneration: 3,
        effects: [{ state: "commit_unknown", requestSnapshot: snapshot(frozen) }],
      } }] };
      await storage.update(storageKey(scope), record);
      frozen.release();
      const restarted = new DurableUploadSpoolStore(root);
      await restarted.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(storage));
      assert.strictEqual(await restarted.verify(snapshot(frozen)), true);
      assert.deepStrictEqual(storage.get(storageKey(scope)), record);
    });
  }

  test("SP-08: all-scope old-generation and legacy persisted references retain bytes until the last removal", async () => {
    const frozen = await freeze();
    const storage = memoryStorage();
    const firstKey = storageKey(scope);
    const otherKey = storageKey("https://other.example.test");
    const legacyKey = "redmine.offlineSyncQueue";
    await storage.update(firstKey, { version: 3, operations: [{ payload: { revision: 4, attemptGeneration: 2,
      effects: [{ revision: 1, attemptGeneration: 1, requestSnapshot: snapshot(frozen) }] } }] });
    await storage.update(otherKey, { version: 3, operations: [{ payload: { abandonedAt: "retained",
      effects: [{ state: "commit_unknown", requestSnapshot: snapshot(frozen) }] } }] });
    await storage.update(legacyKey, { tickets: [[10, { effects: [{ requestSnapshot: snapshot(frozen) }] }]] });
    frozen.release();
    for (const key of [firstKey, otherKey]) {
      await storage.update(key, undefined);
      await store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(storage));
      assert.strictEqual(await store.verify(snapshot(frozen)), true);
    }
    await storage.update(legacyKey, undefined);
    await store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(storage));
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
  });

  test("SP-09: filesystem cleanup failure preserves journal and does not poison later storage work", async () => {
    const frozen = await freeze();
    frozen.release();
    const storage = memoryStorage();
    const record = { version: 3, operations: [{ payload: { phase: "completed", revision: 5 } }] };
    await storage.update(storageKey(scope), record);
    const unlink = fs.promises.unlink;
    fs.promises.unlink = async () => { throw new Error("simulated filesystem failure"); };
    try {
      await assert.rejects(store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(storage)), /filesystem failure/);
      assert.deepStrictEqual(storage.get(storageKey(scope)), record);
      assert.strictEqual(await store.verify(snapshot(frozen)), true);
    } finally { fs.promises.unlink = unlink; }
    await store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(storage));
    assert.strictEqual(fs.existsSync(frozen.spoolFilePath), false);
  });

  test("SP-09: completion-triggered cleanup failure warns without reverting completion or retrying remote writes", async () => {
    const frozen = await freeze();
    const storage = memoryStorage();
    const previousScope = getActiveScope();
    initializeOfflineSyncStore(storage, scope);
    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "cleanup-completion" };
    const operation: UnifiedSyncOperation<TicketCreateIntent> = {
      operationId: "cleanup-completion", kind: "ticket_create", key, connectionScope: scope,
      revision: 1, attemptGeneration: 1, persistenceVersion: 1,
      phase: "local_finalize_pending", createdRemoteId: 123,
      intent: { projectId: 1, subject: "completed ticket", description: "body",
        metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] } },
      effects: [
        { effectId: "ticket-create", kind: "ticket_create", operationRevision: 1,
          attemptGeneration: 1, state: "committed", remoteId: 123, target: {} },
        { effectId: "attachment:file", kind: "attachment_upload", operationRevision: 1,
          attemptGeneration: 1, state: "committed", token: "uploaded-token", target: {}, requestSnapshot: snapshot(frozen) },
      ],
    };
    assert.ok(await repository.saveOperation(operation, scope));
    frozen.release();
    let remoteWrites = 0;
    const handler: OperationHandler<TicketCreateIntent, undefined> = {
      prepare: async () => ({ ok: true, prepared: undefined }),
      executeRemoteWrite: async () => { remoteWrites++; return { ok: true, createdRemoteId: 123 }; },
      reconcileRemote: async () => ({ ok: true, remoteId: 123 }),
      finalizeLocal: async () => ({ ok: true }),
    };
    const coordinator = new SyncCoordinator({ repository, handlers: { ticketCreate: handler } });
    const warnings: unknown[] = [];
    let onWarning: () => void = () => undefined;
    const warned = new Promise<void>((resolve) => { onWarning = resolve; });
    const observer = observeUploadSpoolCleanup({ store, storage,
      warn: (error) => { warnings.push(error); onWarning(); } });
    const unlink = fs.promises.unlink;
    fs.promises.unlink = async () => { throw new Error("simulated completion cleanup failure"); };
    try {
      const outcome = await coordinator.sync(key, { connectionScope: scope });
      assert.strictEqual(outcome.kind, "completed");
      await warned;
      assert.ok(warnings[0] instanceof Error);
      assert.strictEqual(repository.getOperation(key, scope)?.phase, "completed");
      assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 0);
      const persisted = structuredClone(storage.get<unknown>(storageKey(scope)));
      await observer.cleanup();
      await coordinator.sync(key, { connectionScope: scope });
      assert.deepStrictEqual(storage.get(storageKey(scope)), persisted);
      assert.strictEqual(repository.getOperation(key, scope)?.phase, "completed");
      assert.strictEqual(remoteWrites, 0);
      assert.strictEqual(await store.verify(snapshot(frozen)), true);
    } finally {
      fs.promises.unlink = unlink;
      observer.dispose();
      initializeOfflineSyncStore(memoryStorage(), previousScope);
    }
  });
});
