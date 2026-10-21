import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { createSyncEngine } from "../app/syncEngine";
import { getPrimaryEffectForRevision } from "../app/syncEffects";
import { initializeApiKeyStore, setApiKeyForScope } from "../config/apiKeyStore";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { getIssueDetail } from "../redmine/issues";
import {
  addOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { MemorySecretStorage } from "./helpers/secretStorage";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

type RemoteState = {
  estimatedHours?: number;
  appliedHours?: number;
  updates: string[];
};

const withIssueServer = async (
  check: (scope: string, state: RemoteState, memento: TestMemento) => Promise<void>,
): Promise<void> => {
  const previousScope = getCurrentConnectionScope();
  const secrets = new MemorySecretStorage();
  const subscriptions: vscode.Disposable[] = [];
  const memento = createTestMemento();
  const state: RemoteState = { updates: [] };
  const server = http.createServer((request, response) => {
    if (request.method === "PUT" && request.url === "/issues/501.json") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        state.updates.push(body);
        state.estimatedHours = state.appliedHours;
        // サーバーへの反映後に応答が失われた状態を、実際の transport で再現する。
        request.socket.destroy();
      });
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Type", "application/json");
    if (pathname === "/issues/501.json") {
      response.end(JSON.stringify({ issue: {
        id: 501, subject: "Ticket", description: "Description",
        project: { id: 1, name: "Project" }, estimated_hours: state.estimatedHours,
      } }));
    } else if (pathname === "/issue_statuses.json") {
      response.end(JSON.stringify({ issue_statuses: [] }));
    } else if (pathname === "/trackers.json") {
      response.end(JSON.stringify({ trackers: [] }));
    } else if (pathname === "/enumerations/issue_priorities.json") {
      response.end(JSON.stringify({ issue_priorities: [] }));
    } else {
      response.writeHead(404).end();
    }
  });

  try {
    await initializeApiKeyStore(secrets, subscriptions);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const scope = `http://127.0.0.1:${address.port}/`;
    await setApiKeyForScope(scope, "test-estimated-hours-key");
    initializeOfflineSyncStore(memento, scope);
    await runWithConnectionScope(scope, () => check(scope, state, memento));
  } finally {
    subscriptions.forEach((subscription) => subscription.dispose());
    secrets.dispose();
    initializeOfflineSyncStore(createTestMemento(), previousScope);
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
};

suite("予定工数の詳細取得と結果不明更新の照合", () => {
  for (const value of [0, 4.5, undefined]) {
    test(`getIssueDetail は estimated_hours=${String(value)} をそのまま取り込む`, async () => {
      await withIssueServer(async (_scope, state) => {
        state.estimatedHours = value;
        assert.strictEqual((await getIssueDetail(501)).ticket.estimatedHours, value);
      });
    });
  }

  for (const expectedHours of [0, 4.5]) {
    test(`予定工数${expectedHours}の反映後に応答が失われても、再送せず照合で復旧できる`, async () => {
      await withIssueServer(async (scope, state, memento) => {
        state.estimatedHours = 2;
        state.appliedHours = expectedHours;
        const metadata = { tracker: "", status: "", priority: "", due_date: "", children: [] };
        await addOfflineTicketUpdateAsync(501, {
          ticketId: 501, subject: "Ticket", description: "Description",
          baseSubject: "Ticket", baseDescription: "Description",
          baseMetadata: { ...metadata, estimated_hours: 2 },
          metadata: { ...metadata, estimated_hours: expectedHours },
        }, scope);
        const key = { kind: "ticket" as const, ticketId: 501 };
        const context = { connectionScope: scope };
        const engine = createSyncEngine();
        assert.strictEqual((await engine.syncOne(key, context)).kind, "commit_unknown");
        assert.strictEqual(state.updates.length, 1);
        assert.deepStrictEqual(JSON.parse(state.updates[0]), { issue: { estimated_hours: expectedHours } });

        initializeOfflineSyncStore(memento, scope);
        const operation = engine.getRepository().getOperation(key, scope);
        assert.ok(operation);
        const snapshot = getPrimaryEffectForRevision(operation)?.requestSnapshot;
        assert.ok(snapshot?.kind === "ticket_update");
        assert.strictEqual(snapshot.request.fields.estimatedHours, expectedHours);

        for (const unconfirmedHours of [expectedHours + 1, undefined]) {
          state.estimatedHours = unconfirmedHours;
          const outcome = await engine.resolveTicketCommitUnknown({ key, context, resolution: { kind: "reconcile_remote" } });
          assert.strictEqual(outcome.kind, "commit_unknown");
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(501), true);
          assert.strictEqual(state.updates.length, 1, "不一致・欠落時にもPUTを再送しない");
        }

        state.estimatedHours = expectedHours;
        const outcome = await engine.resolveTicketCommitUnknown({ key, context, resolution: { kind: "reconcile_remote" } });
        assert.strictEqual(outcome.kind, "completed");
        assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(501), false);
        assert.strictEqual(state.updates.length, 1, "一致時もGETによる照合だけで完了する");
      });
    });
  }
});
