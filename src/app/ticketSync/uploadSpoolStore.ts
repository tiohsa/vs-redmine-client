import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import type { Memento } from "vscode";
import { getConnectionScopeHash } from "../../config/connectionScope";
import { computeBufferHashAndSize, computeFileHashAndSizeAsync } from "../../utils/fileHash";
import type { UploadRequestSnapshot } from "../syncEffects";
import type { FrozenUpload, UploadSpoolStore } from "./ports";

const writerSession = randomUUID();
const sharedOwners = new Map<string, { pending: Promise<unknown>; leases: Map<string, number> }>();
const EMPTY_WINDOW_OWNER_KEY = "redmine.uploadSpoolOwner";

/** 空 window でも再起動後に同じ spool ownership を回収できるよう永続化する。 */
export const resolveUploadSpoolOwner = async (
  storage: Memento,
  storageUri: string | undefined,
): Promise<string> => {
  if (storageUri) { return storageUri; }
  const existing = storage.get<unknown>(EMPTY_WINDOW_OWNER_KEY);
  if (typeof existing === "string" && existing.length > 0) { return existing; }
  const owner = `empty-window:${randomUUID()}`;
  await storage.update(EMPTY_WINDOW_OWNER_KEY, owner);
  return owner;
};

const isWriterAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Permission errors and PID reuse retain bytes conservatively.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

let defaultStore: UploadSpoolStore | undefined;

export const setDefaultUploadSpoolStore = (store: UploadSpoolStore | undefined): void => {
  defaultStore = store;
};

export const getDefaultUploadSpoolStore = (): UploadSpoolStore => {
  if (!defaultStore) {
    throw new Error("Upload spool storage has not been initialized.");
  }
  return defaultStore;
};

/** Extension が所有する immutable bytes と、永続参照前の lease を管理する。 */
export class DurableUploadSpoolStore implements UploadSpoolStore {
  private readonly root: string;
  private readonly filenamePrefix: string;
  private readonly shared: { pending: Promise<unknown>; leases: Map<string, number> };

  public constructor(globalStoragePath: string, ownershipNamespace = "default") {
    this.root = path.resolve(globalStoragePath, "sync-spool");
    // globalStorage は全 workspace 共通、永続 queue は workspaceState 所有。
    this.filenamePrefix = `${createHash("sha256").update(ownershipNamespace).digest("hex").slice(0, 16)}-`;
    const ownerKey = `${this.root}\0${this.filenamePrefix}`;
    const shared = sharedOwners.get(ownerKey) ?? { pending: Promise.resolve(), leases: new Map<string, number>() };
    sharedOwners.set(ownerKey, shared);
    this.shared = shared;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const current = this.shared.pending.then(task);
    this.shared.pending = current.catch(() => undefined);
    return current;
  }

  public async freezeFile(input: {
    connectionScope: string;
    sourcePath: string;
    filename: string;
    expected?: { contentHash: string; contentSize: number };
  }): Promise<FrozenUpload> {
    return this.publish(input, async (handle) => {
      const hash = createHash("sha256");
      let contentSize = 0;
      for await (const chunk of fs.createReadStream(input.sourcePath)) {
        if (!Buffer.isBuffer(chunk)) { throw new Error("Unexpected file stream chunk."); }
        hash.update(chunk);
        contentSize += chunk.length;
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
          if (bytesWritten === 0) { throw new Error("Spool write made no progress."); }
          offset += bytesWritten;
        }
      }
      const identity = { contentHash: hash.digest("hex"), contentSize };
      if (input.expected && (identity.contentHash !== input.expected.contentHash ||
          identity.contentSize !== input.expected.contentSize)) {
        throw new Error("File content has changed since original snapshot.");
      }
      return identity;
    });
  }

  public freezeBuffer(input: {
    connectionScope: string;
    buffer: Uint8Array;
    filename: string;
    contentType: string;
  }): Promise<FrozenUpload> {
    // 呼び出し元の buffer mutation も frozen identity を変更できない。
    const bytes = Buffer.from(input.buffer);
    const identity = computeBufferHashAndSize(bytes);
    return this.publish(input, async (handle) => {
      await handle.writeFile(bytes);
      return identity;
    });
  }

  /** 完成した同一 directory の temp を link し、既存 final を上書きせず atomic に公開する。 */
  private publish(
    input: { connectionScope: string; filename: string },
    write: (handle: fs.promises.FileHandle) => Promise<{ contentHash: string; contentSize: number }>,
  ): Promise<FrozenUpload> {
    return this.exclusive(async () => {
      const directory = path.join(this.root, getConnectionScopeHash(input.connectionScope));
      const basename = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "attachment";
      const safeFilename = `${this.filenamePrefix}${process.pid}-${writerSession}-${basename}`;
      await fs.promises.mkdir(directory, { recursive: true });
      // Cleanup が writer ownership / liveness を判定できる名前を temp にも付ける。
      const temporaryPath = path.join(directory, `${"0".repeat(64)}-${this.filenamePrefix}${process.pid}-${writerSession}-temp-${randomUUID()}`);
      let temporaryRemoved = false;
      try {
        const handle = await fs.promises.open(temporaryPath, "wx");
        let identity: { contentHash: string; contentSize: number };
        try {
          identity = await write(handle);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (!await this.verify({ kind: "upload", filename: input.filename,
          contentType: "application/octet-stream", spoolFilePath: temporaryPath, ...identity })) {
          throw new Error(`Spool file identity mismatch: ${temporaryPath}`);
        }
        const spoolFilePath = path.join(directory, `${identity.contentHash}-${safeFilename}`);
        try {
          await fs.promises.link(temporaryPath, spoolFilePath);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") { throw error; }
          if (!await this.verify({ kind: "upload", filename: input.filename,
            contentType: "application/octet-stream", spoolFilePath, ...identity })) {
            throw new Error(`Spool file identity mismatch: ${spoolFilePath}`);
          }
        }
        await fs.promises.rm(temporaryPath, { force: true });
        temporaryRemoved = true;
        this.shared.leases.set(spoolFilePath, (this.shared.leases.get(spoolFilePath) ?? 0) + 1);
        let released = false;
        return { ...identity, spoolFilePath, release: () => {
          if (released) { return; }
          released = true;
          const remaining = (this.shared.leases.get(spoolFilePath) ?? 1) - 1;
          if (remaining) { this.shared.leases.set(spoolFilePath, remaining); }
          else { this.shared.leases.delete(spoolFilePath); }
        } };
      } finally {
        if (!temporaryRemoved) { await fs.promises.rm(temporaryPath, { force: true }); }
      }
    });
  }

  public async verify(snapshot: UploadRequestSnapshot): Promise<boolean> {
    if (!snapshot.spoolFilePath) { return false; }
    const identity = await computeFileHashAndSizeAsync(snapshot.spoolFilePath);
    return identity !== undefined && identity.contentHash === snapshot.contentHash &&
      identity.contentSize === snapshot.contentSize;
  }

  public cleanupUnreferenced(references: () => ReadonlySet<string>): Promise<void> {
    return this.exclusive(async () => {
      // await 中に永続化・release された lease も、この pass の終了まで保護する。
      const protectedPaths = new Set([...references(), ...this.shared.leases.keys()]);
      let scopes: fs.Dirent[];
      try { scopes = await fs.promises.readdir(this.root, { withFileTypes: true }); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") { return; }
        throw error;
      }
      for (const scope of scopes) {
        if (!scope.isDirectory() || !/^[a-f0-9]{16}$/.test(scope.name)) { continue; }
        const directory = path.join(this.root, scope.name);
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile()) { continue; }
          if (!/^[a-f0-9]{64}-/.test(entry.name) || !entry.name.slice(65).startsWith(this.filenamePrefix)) { continue; }
          const writer = /^(\d+)-([a-f0-9-]{36})-/.exec(entry.name.slice(65 + this.filenamePrefix.length));
          if (writer && (Number(writer[1]) !== process.pid || writer[2] !== writerSession) &&
              isWriterAlive(Number(writer[1]))) { continue; }
          const candidate = path.join(directory, entry.name);
          if (this.shared.leases.has(candidate) || protectedPaths.has(candidate)) { continue; }
          await fs.promises.unlink(candidate);
        }
      }
    });
  }
}
