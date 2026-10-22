import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createSyncEngine } from "../../app/syncEngine";
import { getPrimaryEffectForRevision } from "../../app/syncEffects";
import { DurableUploadSpoolStore, resolveUploadSpoolOwner } from "../../app/ticketSync/uploadSpoolStore";
import type { SyncOperationKey, TicketUpdateIntent } from "../../app/ticketSync/syncOperationTypes";
import { initializeApiKeyStore, resolveApiKeyForScope, setApiKeyForScope } from "../../config/apiKeyStore";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { createIssue, getIssueDetail } from "../../redmine/issues";
import { requestJson, runWithConnectionScope } from "../../redmine/client";
import { initializeOfflineSyncStore } from "../../views/offlineSyncStore";
import { getLiveHostContext } from "./hostContext";

interface RestartState {
  hostPid?: number;
  projectId?: number;
  holdPath?: string;
  issueId?: number;
  subject?: string;
  operationId?: string;
  attachmentPath?: string;
  spoolFilePath?: string;
  spoolContentHash?: string;
  spoolContentSize?: number;
}

interface ProxyTrace {
  method: string;
  path: string;
  statusCode?: number;
}

const phase = process.env.REDMINE_LIVE_PHASE;
const statePath = process.env.REDMINE_LIVE_STATE_PATH;
const markerPath = process.env.REDMINE_LIVE_MARKER_PATH;
const tracePath = process.env.REDMINE_LIVE_TRACE_PATH;
const upstream = "http://127.0.0.1:3000/";
const proxyScope = process.env.REDMINE_LIVE_PROXY_URL;
const liveTestEnabled = phase === "prepare" || phase === "resume";

const loadState = (): RestartState => {
  if (!statePath || !fs.existsSync(statePath)) { return {}; }
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as RestartState;
};

const saveState = (value: RestartState): void => {
  assert.ok(statePath, "runnerがstate pathを渡していること");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, statePath);
};

const readTraces = (): ProxyTrace[] => {
  if (!tracePath || !fs.existsSync(tracePath)) { return []; }
  return JSON.parse(fs.readFileSync(tracePath, "utf8")) as ProxyTrace[];
};

const waitForMarker = async (): Promise<void> => {
  assert.ok(markerPath, "runnerがmarker pathを渡していること");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) { return; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("remote writeのcheckpointを受け取れませんでした。");
};

const readIssueDirect = (issueId: number) => runWithConnectionScope(upstream, () => getIssueDetail(issueId));
const createIssueDirect = async (subject: string): Promise<number> => runWithConnectionScope(upstream, async () => {
  const trackers = await requestJson<{ trackers: Array<{ id: number }> }>({ method: "GET", path: "/trackers.json" });
  const identifier = `sync-restart-${process.pid}-${Date.now()}`;
  const project = await requestJson<{ project: { id: number } }>({ method: "POST", path: "/projects.json",
    body: { project: { identifier, name: identifier, is_public: false, tracker_ids: trackers.trackers.map((item) => item.id) } },
  });
  saveState({ projectId: project.project.id, hostPid: process.pid });
  const id = await createIssue({ projectId: project.project.id, subject, description: "restart recovery fixture" });
  saveState({ ...loadState(), issueId: id });
  assert.ok(id, "fixture issueにIDがあること");
  return id!;
});

suite("実Redmine同期プロセス再起動", function () {
  this.timeout(120_000);

  (liveTestEnabled ? test : test.skip)("LIVE-P01: remote write後のhost再起動でoperation・SecretStorage・spoolを復旧する", async () => {
    assert.ok(phase === "prepare" || phase === "resume");
    assert.ok(statePath && markerPath && tracePath);
    assert.ok(proxyScope, "runner常駐proxy URLが設定されていること");
    const apiKey = process.env.REDMINE_API_KEY;
    assert.ok(apiKey, "live Redmine API keyが設定されていること");
    const host: vscode.ExtensionContext = (() => {
      const context = getLiveHostContext();
      assert.ok(context, "fixture extensionから実ExtensionContextが共有されていること");
      return context!;
    })();

    await initializeApiKeyStore(host.secrets, host.subscriptions);
    initializeOfflineSyncStore(host.workspaceState, proxyScope);
    if (phase === "prepare") {
      await setApiKeyForScope(upstream, apiKey!);
      await setApiKeyForScope(proxyScope, apiKey!);

      const subject = `LIVE-RESTART ${Date.now()}`;
      const issueId = await createIssueDirect(subject);
      const attachmentPath = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? host.globalStorageUri.fsPath,
        `restart-attachment-${process.pid}.bin`,
      );
      const attachmentBytes = Buffer.from("restart-persistent-spool-fixture\n", "utf8");
      fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
      fs.writeFileSync(attachmentPath, attachmentBytes);

      const detail = await readIssueDirect(issueId);
      const baseMetadata = metadataFromTicket(detail.ticket);
      const intent: TicketUpdateIntent = {
        ticketId: issueId,
        baseSubject: detail.ticket.subject,
        baseDescription: detail.ticket.description ?? "",
        baseMetadata,
        subject: `${subject} updated`,
        description: detail.ticket.description ?? "restart recovery fixture",
        metadata: baseMetadata,
        attachments: [{ kind: "file", filePath: attachmentPath, filename: path.basename(attachmentPath), contentType: "application/octet-stream" }],
        lastKnownRemoteUpdatedAt: detail.ticket.updatedAt,
      };
      const key: SyncOperationKey = { kind: "ticket", ticketId: issueId };
      const operationId = `live-restart-${Date.now()}-${process.pid}`;
      const engine = createSyncEngine();
      await engine.getRepository().saveOperation({
        operationId,
        kind: "ticket_update",
        key,
        connectionScope: proxyScope,
        phase: "queued",
        revision: 1,
        intentRevision: 1,
        attemptGeneration: 1,
        version: 1,
        persistenceVersion: 1,
        intent,
        ticketId: issueId,
        projectId: detail.ticket.projectId,
        documentUri: intent.documentUri,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, proxyScope);
      saveState({
        ...loadState(),
        holdPath: `/issues/${issueId}.json`,
        issueId,
        subject: intent.subject,
        operationId,
        attachmentPath,
      });
      const run = engine.syncOne(key, { connectionScope: proxyScope });
      await Promise.race([
        waitForMarker(),
        run.then(() => assert.fail("proxy応答を保留している間にsyncが完了しました。")),
        run.catch((error: unknown) => { throw error; }),
      ]);
      // proxyがremote 2xx後の応答を保留している。runnerがこのhost processをkillする。
      await new Promise<void>(() => undefined);
      return;
    }

    const state = loadState();
    assert.ok(state.issueId && state.operationId && state.subject && state.attachmentPath);
    assert.ok((await resolveApiKeyForScope(proxyScope)) === apiKey, "同じ実SecretStorageからscope別API keyが復元されること");
    const key: SyncOperationKey = { kind: "ticket", ticketId: state.issueId! };
    const engine = createSyncEngine();
    const operation = engine.getRepository().getOperation(key, proxyScope);
    assert.ok(operation, "workspaceStateから同じoperationが復元されること");
    assert.strictEqual(operation!.operationId, state.operationId);
    const effect = getPrimaryEffectForRevision(operation!);
    assert.ok(effect, "remote writeに対応するprimary effectが残っていること");
    const uploadEffect = operation!.effects?.find((candidate) => candidate.requestSnapshot?.kind === "upload");
    assert.ok(uploadEffect, "attachment upload effectが同じoperationに保存されていること");
    if (uploadEffect!.requestSnapshot?.kind !== "upload") {
      throw new Error("attachment upload request snapshotがありません。");
    }
    const snapshot = uploadEffect!.requestSnapshot;
    assert.ok(snapshot.spoolFilePath, "snapshotがdurable spool pathを保持していること");
    const owner = await resolveUploadSpoolOwner(host.workspaceState, host.storageUri?.toString());
    const spool = new DurableUploadSpoolStore(host.globalStorageUri.fsPath, owner);
    assert.strictEqual(await spool.verify(snapshot), true, "再起動後もfrozen attachment bytesが一致すること");
    const attachment = fs.readFileSync(state.attachmentPath!);
    assert.strictEqual(snapshot.contentSize, attachment.length);
    assert.ok(snapshot.contentHash);

    const remote = await readIssueDirect(state.issueId!);
    assert.strictEqual(remote.ticket.subject, state.subject, "remote writeはhost停止前にcommit済みであること");
    const priorWrites = readTraces().filter((trace) => trace.method === "PUT" && trace.path === `/issues/${state.issueId}.json`);
    assert.strictEqual(priorWrites.length, 1, "host停止前のremote writeが一回だけ記録されていること");

    const retry = await engine.syncOne(key, { connectionScope: proxyScope });
    assert.strictEqual(retry.kind, "commit_unknown", "通常同期は未確定writeを再送しないこと");
    const noRetryWrites = readTraces().filter((trace) => trace.method === "PUT" && trace.path === `/issues/${state.issueId}.json`);
    assert.strictEqual(noRetryWrites.length, 1, "通常同期で同じremote writeを再送しないこと");
    let outcome = await engine.resolveTicketCommitUnknown({
      key: key as Extract<SyncOperationKey, { kind: "ticket" | "newTicket" }>,
      context: { connectionScope: proxyScope },
      resolution: { kind: "reconcile_remote" },
    });
    if (outcome.kind !== "completed") {
      outcome = await engine.syncOne(key, { connectionScope: proxyScope });
    }
    assert.strictEqual(outcome.kind, "completed", "restart後にremote reconcileとlocal finalizeが完了すること");
    const after = engine.getRepository().getOperation(key, proxyScope);
    assert.strictEqual(after?.phase, "completed");
    const finalWrites = readTraces().filter((trace) => trace.method === "PUT" && trace.path === `/issues/${state.issueId}.json`);
    assert.strictEqual(finalWrites.length, 1, "再起動後に同じremote writeを再送しないこと");
    fs.rmSync(state.attachmentPath!, { force: true });
  });
});
