import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { createSyncEngine, type SyncEngine } from "../../app/syncEngine";
import type { SyncOperationKey, TicketCreateIntent, TicketUpdateIntent } from "../../app/ticketSync/syncOperationTypes";
import { clearApiKeyForScope, initializeApiKeyStore, setApiKeyForScope } from "../../config/apiKeyStore";
import { requestJson, runWithConnectionScope, type RequestOptions } from "../../redmine/client";
import { createIssue, getIssueDetail, type IssueCreateInput, type IssueDetailResult } from "../../redmine/issues";
import { initializeDraftStore } from "../../views/ticketDraftStore";
import { createGlobalStateDraftStorage } from "../../views/draftPersistence";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type { IssueMetadata } from "../../views/ticketMetadataTypes";
import {
  addOfflineCommentUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  type OfflineCommentUpdate,
} from "../../views/offlineSyncStore";
import { DurableUploadSpoolStore, setDefaultUploadSpoolStore } from "../../app/ticketSync/uploadSpoolStore";
import { getLiveHostContext } from "./hostContext";
import { createFaultProxy, type FaultProxy, type ProxyTrace } from "./faultProxy";

const upstream = "http://127.0.0.1:3000/";
export const liveEnabled = process.env.REDMINE_SYNC_LIVE_URL?.replace(/\/$/, "") === upstream.slice(0, -1) &&
  Boolean(process.env.REDMINE_API_KEY) && process.env.REDMINE_LIVE_PHASE === undefined;

export interface LiveFixture {
  scope: string;
  context: { connectionScope: string };
  projectId: number;
  metadata: IssueMetadata;
  directory: string;
  storage: vscode.Memento;
  proxy: FaultProxy;
  run<T>(operation: () => Promise<T>): Promise<T>;
  request<T>(options: RequestOptions): Promise<T>;
  engine(): SyncEngine;
  createIssue(input?: Partial<IssueCreateInput>): Promise<number>;
  readIssue(id: number): Promise<IssueDetailResult>;
  queueTicket(id: number, changes: Partial<TicketUpdateIntent>): Promise<Extract<SyncOperationKey, { kind: "ticket" }>>;
  queueNewTicket(changes?: Partial<TicketCreateIntent>): Promise<Extract<SyncOperationKey, { kind: "newTicket" }>>;
  queueComment(ticketId: number, body: string, extras?: Partial<OfflineCommentUpdate>): Promise<Extract<SyncOperationKey, { kind: "comment" }>>;
}

interface RunState {
  projectId: number;
  projectIdentifier: string;
  proxy: FaultProxy;
  spool: DurableUploadSpoolStore;
  metadata: IssueMetadata;
  directory: string;
}
let state: RunState | undefined;
const outcomes: Array<{ id: string; title: string; status: "passed" | "failed"; durationMs: number;
  traces: ProxyTrace[]; directRequests: Array<{ method: string; path: string }>; error?: string }> = [];

const direct = <T>(operation: () => Promise<T>): Promise<T> => runWithConnectionScope(upstream, operation);
const getHost = (): vscode.ExtensionContext => {
  const context = getLiveHostContext();
  if (!context) { throw new Error("実ExtensionContextがありません。run-live-redmine-tests.cjsで起動してください。"); }
  return context;
};

if (liveEnabled) {
  suiteSetup(async function () {
    this.timeout(120_000);
    const host = getHost();
    const key = process.env.REDMINE_API_KEY;
    if (!key) { throw new Error("実Redmine用APIキーがありません。"); }
    await initializeApiKeyStore(host.secrets, host.subscriptions);
    await setApiKeyForScope(upstream, key);
    const who = await direct(() => requestJson<{ user: { login: string } }>({ method: "GET", path: "/users/current.json" }));
    assert.strictEqual(who.user.login, "admin");
    const identifier = `sync-live-${randomUUID().slice(0, 12)}`;
    const trackers = await direct(() => requestJson<{ trackers: Array<{ id: number; name: string }> }>({ method: "GET", path: "/trackers.json" }));
    const project = await direct(() => requestJson<{ project: { id: number } }>({
      method: "POST", path: "/projects.json", body: {
        project: { identifier, name: identifier, is_public: false, tracker_ids: trackers.trackers.map((tracker) => tracker.id),
          enabled_module_names: ["issue_tracking", "time_tracking"] },
      },
    }));
    const statuses = await direct(() => requestJson<{ issue_statuses: Array<{ id: number; name: string; is_closed?: boolean }> }>({ method: "GET", path: "/issue_statuses.json" }));
    const priorities = await direct(() => requestJson<{ issue_priorities: Array<{ id: number; name: string; is_default?: boolean }> }>({ method: "GET", path: "/enumerations/issue_priorities.json" }));
    const proxy = await createFaultProxy(upstream);
    await setApiKeyForScope(proxy.origin, key);
    const directory = path.join(host.globalStorageUri.fsPath, identifier);
    fs.mkdirSync(directory, { recursive: true });
    const spool = new DurableUploadSpoolStore(host.globalStorageUri.fsPath, identifier);
    setDefaultUploadSpoolStore(spool);
    state = {
      projectId: project.project.id, projectIdentifier: identifier, proxy, directory, spool,
      metadata: { tracker: trackers.trackers[0].name,
        status: statuses.issue_statuses.find((status) => !status.is_closed)?.name ?? statuses.issue_statuses[0].name,
        priority: (priorities.issue_priorities.find((priority) => priority.is_default) ?? priorities.issue_priorities[0]).name,
        due_date: "", children: [] },
    };
    const configuration = vscode.workspace.getConfiguration("redmine-client");
    await configuration.update("baseUrl", proxy.origin, vscode.ConfigurationTarget.Workspace);
    await configuration.update("defaultProjectId", String(project.project.id), vscode.ConfigurationTarget.Workspace);
    await configuration.update("offlineSyncMode", "manual", vscode.ConfigurationTarget.Workspace);
    await configuration.update("editorStorageDirectory", directory, vscode.ConfigurationTarget.Workspace);
    initializeOfflineSyncStore(host.workspaceState, proxy.origin);
    initializeDraftStore(createGlobalStateDraftStorage(host.globalState, proxy.origin), proxy.origin);
  });
  suiteTeardown(async function () {
    this.timeout(120_000);
    const current = state;
    if (!current) { return; }
    try {
      await direct(() => requestJson({ method: "DELETE", path: `/projects/${current.projectId}.json` }));
      const deadline = Date.now() + 30_000;
      let deleted = false;
      while (Date.now() < deadline) {
        try { await direct(() => requestJson({ method: "GET", path: `/projects/${current.projectId}.json` })); }
        catch (error) {
          if (error instanceof Error && error.message.includes("404")) { deleted = true; break; }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(deleted, "テスト専用projectの削除が完了すること");
    } finally {
      await clearOfflineSyncQueueAsync(current.proxy.origin);
      await clearApiKeyForScope(current.proxy.origin);
      await clearApiKeyForScope(upstream);
      await current.spool.cleanupUnreferenced(() => new Set());
      await current.proxy.close();
      const resultPath = process.env.REDMINE_LIVE_REPORT_PATH;
      if (resultPath) {
        fs.mkdirSync(path.dirname(resultPath), { recursive: true });
        fs.writeFileSync(resultPath, JSON.stringify({ project: current.projectIdentifier, cases: outcomes }, null, 2));
      }
      fs.rmSync(current.directory, { recursive: true, force: true });
      state = undefined;
    }
  });
}

export const liveTest = (id: string, title: string, operation: (fixture: LiveFixture) => Promise<void>): void => {
  const register = liveEnabled ? test : test.skip;
  register(`${id}: ${title}`, async function () {
    this.timeout(120_000);
    const current = state;
    if (!current) { throw new Error("実Redmine fixtureが初期化されていません。"); }
    const host = getHost();
    current.proxy.reset();
    await clearOfflineSyncQueueAsync(current.proxy.origin);
    const start = Date.now();
    const directRequests: Array<{ method: string; path: string }> = [];
    const engines = (): SyncEngine => createSyncEngine({ uploadSpoolStore: current.spool });
    const save = async (kind: "ticket_create" | "ticket_update", key: SyncOperationKey,
      intent: TicketCreateIntent | TicketUpdateIntent, ticketId?: number): Promise<SyncOperationKey> => {
      await engines().getRepository().saveOperation({
        operationId: `${id}:${randomUUID()}`, kind, key, connectionScope: current.proxy.origin,
        phase: "queued", revision: 1, intentRevision: 1, attemptGeneration: 1, version: 1, persistenceVersion: 1,
        intent, ticketId, projectId: current.projectId, documentUri: intent.documentUri,
        createdAt: Date.now(), updatedAt: Date.now(),
      }, current.proxy.origin);
      return key;
    };
    const fixture: LiveFixture = {
      scope: current.proxy.origin, context: { connectionScope: current.proxy.origin }, projectId: current.projectId,
      metadata: { ...current.metadata }, directory: current.directory, proxy: current.proxy, storage: host.workspaceState,
      run: (fn) => runWithConnectionScope(current.proxy.origin, fn),
      request: (options) => {
        directRequests.push({ method: options.method ?? "GET", path: options.path });
        return direct(() => requestJson(options));
      },
      engine: engines,
      createIssue: async (input = {}) => {
        directRequests.push({ method: "POST", path: "/issues.json" });
        const remoteId = await direct(() => createIssue({ projectId: current.projectId, subject: `${id} ${randomUUID()}`, description: "Base body", ...input }));
        if (!remoteId) { throw new Error("実Redmineのチケット作成結果にIDがありません。"); }
        return remoteId;
      },
      readIssue: (remoteId) => {
        directRequests.push({ method: "GET", path: `/issues/${remoteId}.json` });
        return direct(() => getIssueDetail(remoteId));
      },
      queueTicket: async (remoteId, changes) => {
        const detail = await direct(() => getIssueDetail(remoteId));
        const baseMetadata = metadataFromTicket(detail.ticket);
        const key = { kind: "ticket" as const, ticketId: remoteId };
        await save("ticket_update", key, {
          ticketId: remoteId, baseSubject: detail.ticket.subject, baseDescription: detail.ticket.description ?? "",
          baseMetadata, subject: detail.ticket.subject, description: detail.ticket.description ?? "",
          metadata: baseMetadata, lastKnownRemoteUpdatedAt: detail.ticket.updatedAt,
          ...changes,
        }, remoteId);
        return key;
      },
      queueNewTicket: async (changes = {}) => {
        const queueId = `${id}-${randomUUID()}`;
        const key = { kind: "newTicket" as const, queueId };
        await save("ticket_create", key, {
          projectId: current.projectId, subject: queueId, description: "New body", metadata: { ...current.metadata }, ...changes,
        });
        return key;
      },
      queueComment: async (ticketId, body, extras = {}) => {
        const operationId = extras.operationId ?? `${id}:${randomUUID()}`;
        await addOfflineCommentUpdateAsync({ ticketId, body, ...extras, operationId }, current.proxy.origin);
        const entries = getOfflineSyncQueue(current.proxy.origin).comments;
        const entry = entries.find((item) => item.operationId === operationId) ?? entries.find((item) =>
          item.ticketId === ticketId && item.commentId === extras.commentId && item.documentUri === extras.documentUri);
        if (!entry) { throw new Error("保存したコメントキューが見つかりません。"); }
        return { kind: "comment", ticketId, commentId: entry.commentId, documentUri: entry.documentUri, operationId: entry.operationId };
      },
    };
    try {
      await operation(fixture);
      outcomes.push({ id, title, status: "passed", durationMs: Date.now() - start,
        traces: current.proxy.hits(), directRequests });
    } catch (error) {
      outcomes.push({ id, title, status: "failed", durationMs: Date.now() - start,
        traces: current.proxy.hits(), directRequests,
        error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
};
