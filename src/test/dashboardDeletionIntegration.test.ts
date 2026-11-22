import * as assert from "node:assert/strict";
import * as http from "node:http";
import * as vscode from "vscode";
import { clearApiKeyForScope, initializeApiKeyStore, setApiKeyForScope } from "../config/apiKeyStore";
import { getConnectionScopeHash, getCurrentConnectionScope } from "../config/connectionScope";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardMessageRouter } from "../dashboard/DashboardMessageRouter";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { getTicketIdsWithPendingChanges } from "../dashboard/services/dashboardDeletionProtection";
import { DashboardDeletionService } from "../layers/extension-host/features/delete-redmine-items";
import { RedmineHttpError } from "../redmine/httpError";
import { scheduleTask } from "../packages/framework-core";
import { initializeCommentEdit, setCommentDraftBody, clearCommentEdit, getCommentEdit } from "../views/commentEditStore";
import { clearTicketDraft, initializeTicketDraft, markDraftStatus } from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { addOfflineNewTicketAsync, removeOfflineNewTicketAsync } from "../views/offlineSyncStore";
import { withConfiguration } from "./helpers/configuration";
import { MemorySecretStorage } from "./helpers/secretStorage";

const target = { id: 42, subject: "Selected by action", project: { id: 1, name: "Project" } };
const child = { ...target, id: 43, subject: "Child", parent: { id: target.id } };
const unrelated = { ...target, id: 44, subject: "Another row" };
const grandchild = { ...target, id: 45, subject: "Grandchild", parent: { id: child.id } };

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50 && !condition(); attempt++) {
    await new Promise<void>(resolve => { scheduleTask(resolve, 20); });
  }
  assert.ok(condition());
}

suite("Dashboard 削除の Extension Host 統合", () => {
  test("書き込み中に接続先を切り替えても元の接続先で照合し、新しい画面を更新しない", async () => {
    const originalScope = "https://original.invalid/";
    let currentScope = originalScope;
    let connectionGeneration = 1;
    let deleted = false;
    const requestScopes: string[] = [];
    const presentationChanges: string[] = [];
    const service = new DashboardDeletionService({
      getConnectionScope: () => currentScope,
      getConnectionGeneration: () => connectionGeneration,
      withConnectionScope: (scope, operation) => {
        requestScopes.push(scope);
        return operation();
      },
      getIssueDetail: async () => {
        if (deleted) { throw new RedmineHttpError(404, "gone"); }
        return { ticket: target, comments: [] };
      },
      getHttpStatusCode: error => error instanceof RedmineHttpError ? error.statusCode : undefined,
      deleteIssue: async () => {
        deleted = true;
        currentScope = "https://different.invalid/";
        connectionGeneration++;
      },
      clearJournalNotes: async () => { throw new Error("The test requested a ticket deletion."); },
      getPendingTicketIds: () => [],
      getPendingChangeReview: () => [],
      reviewPendingChanges: async () => false,
      assertCanDelete: () => undefined,
      runProtectedDelete: (_target, operation) => operation(),
      confirmDelete: async () => true,
      refreshTickets: async () => { presentationChanges.push("tickets"); },
      refreshComments: async () => { presentationChanges.push("comments"); },
      clearSelectedTicket: () => { presentationChanges.push("ticket selection"); },
      clearSelectedComment: () => { presentationChanges.push("comment selection"); },
      notifySuccess: () => { presentationChanges.push("success"); },
      notifyError: () => { presentationChanges.push("error"); },
    });

    await service.deleteTicket({ requestId: "scope", ticketId: target.id, connectionGeneration });
    assert.strictEqual(deleted, true);
    assert.deepStrictEqual(requestScopes, [originalScope, originalScope, originalScope, originalScope]);
    assert.strictEqual(presentationChanges.length, 0);
  });

  test("承認した行だけを Redmine から削除し、読み戻し後に選択と検索・コメント表示を更新する", async () => {
    const journals = [
      { id: 90, user: { id: 1, name: "Author" }, notes: "", details: [] },
      { id: 107, user: { id: 1, name: "Author" }, notes: "Remove only this note", details: [{ name: "status_id" }] },
      { id: 108, user: { id: 1, name: "Author" }, notes: "Keep this note", details: [] },
    ];
    const issues = new Map([target, child, unrelated, grandchild].map(issue => [issue.id, issue]));
    const writes: Array<{ method?: string; path: string; body: string }> = [];
    const reads: string[] = [];
    let rejectNextWrite = false;
    let interruptNextWriteResponse = false;
    let interruptNextReadBack = false;
    let readBackInterrupted = false;
    let hideChild = false;
    let failListRefresh = false;
    let failAncestryLookup = false;
    const leaf = { ...target, id: 46, subject: "Leaf" };
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/^\/redmine/, "");
      const issueId = Number(/^\/issues\/(\d+)\.json$/.exec(path)?.[1]);
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        reads.push(`${path}${url.search}`);
        if (path === "/issues.json") {
          if (failListRefresh) {
            response.writeHead(503).end("{}");
            return;
          }
          const items = Array.from(issues.values());
          response.end(JSON.stringify({ issues: items, total_count: items.length, limit: 100, offset: 0 }));
        } else if (issues.has(issueId)) {
          if (readBackInterrupted && issueId === target.id) {
            readBackInterrupted = false;
            response.writeHead(503).end("{}");
            return;
          }
          response.end(JSON.stringify({ issue: {
            ...issues.get(issueId),
            ...(issueId === target.id && issues.has(child.id)
              ? { children: hideChild ? [] : [{ id: child.id, children: [{ id: grandchild.id }] }] }
              : {}),
            journals: issueId === target.id ? journals : [],
          } }));
        } else if (Number.isSafeInteger(issueId)) {
          response.writeHead(failAncestryLookup && issueId === 999 ? 503 : 404).end("{}");
        } else {
          response.end(JSON.stringify({ user: { id: 1 }, projects: [], issue_statuses: [], trackers: [], issue_priorities: [] }));
        }
        return;
      }
      request.setEncoding("utf8");
      let body = "";
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        writes.push({ method: request.method, path, body });
        if (rejectNextWrite) {
          rejectNextWrite = false;
          response.writeHead(403).end("{}");
        } else if (request.method === "PUT" && path === "/journals/107.json") {
          journals[1].notes = "";
          if (interruptNextWriteResponse) {
            response.destroy();
          } else {
            response.writeHead(204).end();
          }
          if (interruptNextReadBack) {
            readBackInterrupted = true;
          }
        } else if (request.method === "DELETE" && issueId === target.id) {
          issues.delete(target.id);
          issues.delete(child.id);
          issues.delete(grandchild.id);
          response.writeHead(204).end();
        } else if (request.method === "DELETE" && issueId === leaf.id) {
          issues.delete(leaf.id);
          response.writeHead(204).end();
        } else {
          response.writeHead(404).end("{}");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const originalPrompt = vscode.window.showWarningMessage;
    const originalPicker = Object.getOwnPropertyDescriptor(vscode.window, "showQuickPick");
    const originalShowEditor = Object.getOwnPropertyDescriptor(vscode.window, "showTextDocument");
    const showTextDocument = vscode.window.showTextDocument;
    const originalError = vscode.window.showErrorMessage;
    assert.ok(originalPicker && originalShowEditor);
    const secrets = new MemorySecretStorage();
    const subscriptions: vscode.Disposable[] = [];
    const choices: Array<string | undefined> = [];
    const confirmations: Array<{ message: string; modal: boolean | undefined; detail: string | undefined }> = [];
    const errors: string[] = [];
    const successes: string[] = [];
    const reviews: Array<readonly vscode.QuickPickItem[]> = [];
    const reviewChoices: Array<string | undefined> = [];
    let duringConfirmation: (() => void | Promise<void>) | undefined;
    let duringReview: (() => void | Promise<void>) | undefined;
    let afterOpen: (() => void | Promise<void>) | undefined;
    let afterOpenEditable: ((document: vscode.TextDocument) => void) | undefined;
    try {
      vscode.window.showErrorMessage = async (message: string) => { errors.push(message); return undefined; };
      Object.defineProperty(vscode.window, "showQuickPick", {
        ...originalPicker,
        value: async (items: readonly vscode.QuickPickItem[]) => {
          reviews.push([...items]);
          const choice = reviewChoices.shift();
          const callback = duringReview;
          duringReview = undefined;
          await callback?.();
          return choice ? items.find(item => item.label.startsWith(choice)) : undefined;
        },
      });
      Object.defineProperty(vscode.window, "showTextDocument", {
        ...originalShowEditor,
        value: async (...args: unknown[]) => {
          const editor: vscode.TextEditor = await Reflect.apply(showTextDocument, vscode.window, args);
          if (editor.document.uri.scheme.startsWith("redmine-deletion-review-")) { await afterOpen?.(); }
          else { afterOpenEditable?.(editor.document); }
          return editor;
        },
      });
      vscode.window.showWarningMessage = async (message: string, options?: vscode.MessageOptions) => {
        confirmations.push({ message, modal: options?.modal, detail: options?.detail });
        const choice = choices.shift();
        const callback = duringConfirmation;
        duringConfirmation = undefined;
        await callback?.();
        return choice;
      };
      await withConfiguration("baseUrl", `http://127.0.0.1:${address.port}/redmine/`, async () => {
        const scope = getCurrentConnectionScope();
        await initializeApiKeyStore(secrets, subscriptions);
        await setApiKeyForScope(scope, "dashboard-deletion-test-key");
        const store = new DashboardStateStore();
        const controller = new DashboardController({
          store,
          notifyOperationStarted: () => undefined,
          notifySuccess: (_id, message) => successes.push(message),
          notifyError: (_id, message) => errors.push(message),
          notifyToast: () => undefined,
          onTicketsRefreshed: () => undefined,
        });
        const router = new DashboardMessageRouter(controller);
        let stalePendingId: string | undefined;
        try {
          const generation = store.getState().connectionGeneration;
          const ticketRequest = { type: "deleteTicket" as const, requestId: "ticket", ticketId: target.id, connectionGeneration: generation };
          const commentRequest = { type: "deleteComment" as const, requestId: "comment", ticketId: target.id, commentId: 107, connectionGeneration: generation };
          await router.route({ ...commentRequest, ticketId: unrelated.id });
          assert.match(errors.at(-1) ?? "", /comment.*verified/i);
          assert.strictEqual(confirmations.length, 0);
          await router.route({ ...ticketRequest, connectionGeneration: generation + 1 });
          assert.strictEqual(confirmations.length, 0);

          store.update({ selectedTicketId: unrelated.id });
          let duplicate: Promise<void> | undefined;
          duringConfirmation = () => { duplicate = router.route(ticketRequest); };
          choices.push(undefined);
          await router.route(ticketRequest);
          await duplicate;
          assert.strictEqual(confirmations.length, 1);
          assert.match(confirmations.at(-1)?.message ?? "", /#42.*Selected by action/);
          assert.match(confirmations.at(-1)?.detail ?? "", /child tickets.*time entries/);
          assert.strictEqual(confirmations.at(-1)?.modal, true);
          assert.strictEqual(writes.length, 0);
          assert.strictEqual(store.getState().selectedTicketId, unrelated.id);

          choices.push("Delete");
          hideChild = true;
          duringConfirmation = () => {
            initializeCommentEdit(111, child.id, "remote body", undefined, scope);
            setCommentDraftBody(111, "local draft", scope);
          };
          await router.route(ticketRequest);
          assert.match(errors.at(-1) ?? "", /Pending changes changed|pending sync/);
          assert.strictEqual(writes.length, 0);
          clearCommentEdit(111, scope);
          hideChild = false;

          await router.route({ type: "tickets.search", requestId: "search", query: "row", scope: { kind: "all" } });
          await controller["selectTicket"](target.id);
          store.updateNested("comments", { selectedCommentId: 107 });
          rejectNextWrite = true;
          choices.push("Delete");
          await router.route(commentRequest);
          assert.match(errors.at(-1) ?? "", /403/);
          assert.strictEqual(store.getState().comments.selectedCommentId, 107);
          assert.deepStrictEqual(store.getState().comments.items.map(item => item.id), [107, 108]);

          interruptNextReadBack = true;
          choices.push("Delete");
          await router.route(commentRequest);
          assert.match(confirmations.at(-1)?.message ?? "", /#107.*#42/);
          assert.match(errors.at(-1) ?? "", /could not be confirmed/i);
          assert.deepStrictEqual(writes.map(write => [write.method, write.path, JSON.parse(write.body)]), [
            ["PUT", "/journals/107.json", { journal: { notes: "" } }],
            ["PUT", "/journals/107.json", { journal: { notes: "" } }],
          ]);
          assert.strictEqual(store.getState().comments.selectedCommentId, 107);
          assert.deepStrictEqual(journals[1].details, [{ name: "status_id" }]);
          assert.strictEqual(journals[2].notes, "Keep this note");

          journals[1].notes = "Another deletion attempt";
          interruptNextReadBack = false;
          interruptNextWriteResponse = true;
          choices.push("Delete");
          await router.route(commentRequest);
          assert.strictEqual(writes.length, 3);
          assert.strictEqual(store.getState().selectedTicketId, target.id);
          assert.strictEqual(store.getState().comments.selectedCommentId, undefined);
          assert.deepStrictEqual(store.getState().comments.items.map(item => item.id), [108]);

          const draftUri = vscode.Uri.from({ scheme: "untitled", path: `/${getConnectionScopeHash(scope)}/redmine-client-new-ticket.md` });
          const draft = await vscode.workspace.openTextDocument(draftUri);
          const unsaved = new vscode.WorkspaceEdit();
          unsaved.insert(draftUri, new vscode.Position(0, 0), buildTicketEditorContent({
            subject: "Rename the build job", description: "", layout: "metadata-first",
            metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", parent: 89 },
          }));
          assert.strictEqual(await vscode.workspace.applyEdit(unsaved), true);
          try {
            assert.strictEqual(draft.isDirty, true);
            assert.ok(getTicketIdsWithPendingChanges(scope).includes(89));
            assert.strictEqual(store.getState().unsynced.items.some(item => item.documentUri === draftUri.toString()), false);
            reviewChoices.push("Open");
            let openedPreview = false;
            let previewUri: string | undefined;
            afterOpen = () => {
              const preview = vscode.workspace.textDocuments.find(document => document.uri.scheme.startsWith("redmine-deletion-review-") &&
                document.getText().includes("Rename the build job"));
              assert.ok(preview);
              assert.strictEqual(preview.isDirty, false);
              assert.match(preview.getText(), /draft referencing parent #89.*redmine-client-new-ticket\.md/);
              assert.strictEqual(writes.length, 3);
              previewUri = preview.uri.toString();
              openedPreview = true;
            };
            await router.route(ticketRequest);
            const item = reviews.at(-1)?.find(choice => choice.label.startsWith("Open"));
            assert.match(item?.detail ?? "", /draft referencing parent #89.*Unreadable reference: #89/);
            assert.strictEqual(openedPreview, true, errors.at(-1));
            assert.strictEqual(writes.length, 3);
            const previewTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
              tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === previewUri);
            assert.ok(previewTab);
            assert.strictEqual(await vscode.window.tabGroups.close(previewTab), true);
            const reviewsBeforeRetry = reviews.length;
            reviewChoices.push("Open Unsynced");
            await router.route(ticketRequest);
            assert.strictEqual(reviews.length, reviewsBeforeRetry + 1);
            const unsynced = store.getState().unsynced;
            const row = unsynced.localChanges?.find(change => change.detail.includes("parent #89"));
            assert.ok(row && row.open === "editor");
            stalePendingId = row.id;
            assert.ok(row.focusIds.some(id => unsynced.reveal?.focusIds.includes(id)));
            let reopened = false;
            afterOpenEditable = document => { reopened = document === draft; };
            await router.route({ type: "unsynced.openPendingChange", requestId: "open-draft", itemId: row.id });
            afterOpenEditable = undefined;
            assert.strictEqual(reopened, true);
            assert.strictEqual(draft.isDirty, true);
            assert.strictEqual(writes.length, 3);
            const entry = await addOfflineNewTicketAsync({ content: draft.getText(), documentUri: draftUri.toString() }, scope);
            try {
              const queued = store.getState().unsynced;
              assert.strictEqual(queued.totalCount, 1);
              assert.strictEqual(queued.items[0]?.key.kind, "newTicket");
              assert.strictEqual(queued.localChanges?.length, 0);
              const edit = new vscode.WorkspaceEdit();
              edit.insert(draftUri, draft.lineAt(draft.lineCount - 1).range.end, "\nA newer edit\n");
              assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
              await eventually(() => store.getState().unsynced.totalCount === 2);
              assert.strictEqual(store.getState().unsynced.localChanges?.[0]?.open, "editor");
              await router.route({ type: "unsynced.openPendingChange", requestId: "old-item", itemId: row.id });
              assert.match(errors.at(-1) ?? "", /no longer available/);
            } finally {
              await removeOfflineNewTicketAsync({ queueId: entry.queueId }, scope);
            }
          } finally {
            const cleanup = new vscode.WorkspaceEdit();
            cleanup.delete(draftUri, new vscode.Range(new vscode.Position(0, 0), draft.lineAt(draft.lineCount - 1).range.end));
            await vscode.workspace.applyEdit(cleanup);
          }

          initializeCommentEdit(112, 999, "remote body", undefined, scope);
          setCommentDraftBody(112, "unreadable pending ticket", scope);
          controller.refreshUnsyncedPresentation();
          const previewRow = store.getState().unsynced.localChanges?.find(row => row.detail.includes("Comment #112"));
          assert.ok(previewRow && previewRow.open === "preview");
          assert.match(previewRow.reason ?? "", /original editor is unavailable/i);
          failAncestryLookup = true;
          const promptsBeforeFailure = confirmations.length;
          await router.route(ticketRequest);
          assert.strictEqual(confirmations.length, promptsBeforeFailure);
          assert.match(errors.at(-1) ?? "", /read ticket #999/);
          failAncestryLookup = false;
          assert.strictEqual(store.getState().unsynced.items.some(item => item.label.includes("999")), false);
          reviewChoices.push("Open");
          let previewedChange = false;
          afterOpen = () => {
            const doc = vscode.workspace.textDocuments.find(document => document.uri.scheme.startsWith("redmine-deletion-review-") &&
              document.getText().includes("unreadable pending ticket"));
            assert.ok(doc);
            assert.match(doc.getText(), /Comment #112 on ticket #999/);
            assert.strictEqual(doc.isDirty, false);
            assert.strictEqual(writes.length, 3);
            previewedChange = true;
          };
          await router.route(ticketRequest);
          assert.strictEqual(previewedChange, true);
          assert.ok(reviews.at(-1)?.some(item => `${item.label} ${item.detail}`.includes("#999")));
          assert.strictEqual(writes.length, 3);

          reviewChoices.push("Delete");
          duringReview = () => {
            initializeCommentEdit(114, 998, "remote body", undefined, scope);
            setCommentDraftBody(114, "another unreadable ticket", scope);
          };
          await router.route(ticketRequest);
          assert.match(errors.at(-1) ?? "", /Pending changes changed/);
          assert.strictEqual(writes.length, 3);
          clearCommentEdit(114, scope);

          reviewChoices.push("Delete");
          duringReview = () => setCommentDraftBody(112, "changed after the prompt", scope);
          await router.route(ticketRequest);
          assert.match(errors.at(-1) ?? "", /Pending changes changed/);
          assert.strictEqual(writes.length, 3);
          setCommentDraftBody(112, "unreadable pending ticket", scope);

          initializeTicketDraft(997, "Unreadable draft", "", { tracker: "", priority: "", status: "", due_date: "" }, undefined, scope);
          markDraftStatus(997, "Failed", scope);
          reviewChoices.push("Delete");
          await router.route(ticketRequest);
          assert.ok(reviews.at(-1)?.some(item => (item.detail ?? "").includes("#997")));
          assert.strictEqual(reviews.at(-1)?.some(item => item.label === "Delete"), false);
          assert.strictEqual(writes.length, 3);
          clearTicketDraft(997, scope);

          await controller["selectTicket"](grandchild.id);
          failListRefresh = true;
          reviewChoices.push("Delete");
          await router.route(ticketRequest);
          assert.deepStrictEqual(writes.at(-1), { method: "DELETE", path: "/issues/42.json", body: "" });
          assert.strictEqual(store.getState().ticketSearch?.query, "row");
          assert.deepStrictEqual(store.getState().tickets.map(ticket => ticket.id), [unrelated.id]);
          assert.strictEqual(store.getState().selectedTicketId, undefined);
          assert.strictEqual(store.getState().workPanel, undefined);
          assert.match(store.getState().errors.tickets ?? "", /503/);
          failListRefresh = false;
          await router.route({ type: "tickets.refresh", requestId: "refresh" });
          assert.ok(reads.some(path => path.startsWith("/issues.json?") && path.includes("subject=%7Erow")));
          assert.strictEqual(successes.length, 2);
          assert.strictEqual(getCommentEdit(112, scope)?.draftBody, "unreadable pending ticket");

          issues.set(leaf.id, leaf);
          const leafRequest = { ...ticketRequest, ticketId: leaf.id };
          initializeCommentEdit(113, leaf.id, "remote body", undefined, scope);
          setCommentDraftBody(113, "pending on leaf", scope);
          reviewChoices.push(undefined);
          await router.route(leafRequest);
          assert.ok(reviews.at(-1)?.some(item => (item.detail ?? "").includes("#113")));
          assert.strictEqual(reviews.at(-1)?.some(item => item.label === "Delete"), false);
          assert.strictEqual(writes.length, 4);
          controller.refreshUnsyncedPresentation();
          const blockingDraft = store.getState().unsynced.localChanges?.find(item => item.detail.includes("#113"));
          assert.ok(blockingDraft?.canDiscard);
          choices.push("Discard draft");
          await router.route({ type: "unsynced.discardPendingChange", requestId: "discard-blocking-draft", itemId: blockingDraft.id });
          assert.strictEqual(getCommentEdit(113, scope)?.draftBody, undefined);
          assert.ok(!store.getState().unsynced.localChanges?.some(item => item.id === blockingDraft.id));
          assert.strictEqual(writes.length, 4);
          initializeCommentEdit(112, 999, "remote body", undefined, scope);
          setCommentDraftBody(112, "unreadable pending ticket", scope);
          const readsBeforeLeaf = reads.length;
          choices.push("Delete");
          await router.route(leafRequest);
          assert.ok(reads.slice(readsBeforeLeaf).every(path => !path.startsWith("/issues/999.json")));
          assert.deepStrictEqual(writes.at(-1), { method: "DELETE", path: "/issues/46.json", body: "" });
          assert.strictEqual(successes.length, 4);
          clearCommentEdit(112, scope);

          choices.push("Delete");
          let readsAtSwitch: number | undefined;
          duringConfirmation = async () => {
            await vscode.workspace.getConfiguration("redmine-client").update(
              "baseUrl", `${scope}another/`, vscode.ConfigurationTarget.Global,
            );
            readsAtSwitch = reads.length;
          };
          const writesAfterSuccess = writes.length;
          await router.route({ ...ticketRequest, ticketId: unrelated.id });
          assert.strictEqual(reads.length, readsAtSwitch);
          assert.strictEqual(writes.length, writesAfterSuccess);
          assert.strictEqual(successes.length, 4);
          assert.ok(stalePendingId);
          await router.route({ type: "unsynced.openPendingChange", requestId: "old-scope", itemId: stalePendingId });
          assert.match(errors.at(-1) ?? "", /no longer available/);
        } finally {
          clearCommentEdit(111, scope);
          clearCommentEdit(112, scope);
          clearCommentEdit(113, scope);
          clearCommentEdit(114, scope);
          clearTicketDraft(997, scope);
          controller.dispose();
          await clearApiKeyForScope(scope);
        }
      });
    } finally {
      Object.defineProperty(vscode.window, "showQuickPick", originalPicker);
      Object.defineProperty(vscode.window, "showTextDocument", originalShowEditor);
      vscode.window.showWarningMessage = originalPrompt;
      vscode.window.showErrorMessage = originalError;
      subscriptions.forEach(subscription => subscription.dispose());
      secrets.dispose();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
