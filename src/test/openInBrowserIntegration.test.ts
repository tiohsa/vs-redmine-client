import * as assert from "assert";
import * as http from "node:http";
import * as vscode from "vscode";
import {
  OPEN_COMMENT_IN_BROWSER_COMMAND,
  OPEN_IN_BROWSER_COMMAND,
  OPEN_TICKET_IN_BROWSER_COMMAND,
} from "../app/commandIds";
import { registerBrowserCommands } from "../app/browserCommandRegistrations";
import { getConnectionScopeHash } from "../config/connectionScope";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardMessageRouter } from "../dashboard/DashboardMessageRouter";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { withConfiguration } from "./helpers/configuration";

const openFixture = (scope: string, filename: string): Thenable<vscode.TextDocument> => {
  const hash = getConnectionScopeHash(scope);
  return vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "untitled", path: `/${hash}/${filename}` }));
};

const withoutActiveEditor = async (operation: () => Promise<void>): Promise<void> => {
  const descriptor = Object.getOwnPropertyDescriptor(vscode.window, "activeTextEditor");
  try {
    Object.defineProperty(vscode.window, "activeTextEditor", { configurable: true, get: () => undefined });
    await operation();
  } finally {
    if (descriptor) { Object.defineProperty(vscode.window, "activeTextEditor", descriptor); }
    else { Reflect.deleteProperty(vscode.window, "activeTextEditor"); }
  }
};

suite("ブラウザで開く Extension Host", () => {
  test("登録済みコマンドから文書を開き、コメントの注記番号と接続切替を処理する", async () => {
    const requests: Array<string | undefined> = [];
    const journals = [{ id: 91 }, { id: 99, notes: "コメント" }];
    let onRequest: (response: http.ServerResponse) => void =
      (response) => response.end(JSON.stringify({ issue: { id: 42, journals } }));
    const server = http.createServer((request, response) => {
      if (!request.url?.includes("include=journals")) {
        response.end("{}");
        return;
      }
      requests.push(request.url);
      onRequest(response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const scope = `http://127.0.0.1:${address.port}/redmine/`;

    const originalOpenExternal = vscode.env.openExternal;
    const originalInputBox = vscode.window.showInputBox;
    const originalShowError = vscode.window.showErrorMessage;
    const opened: string[] = [];
    const errors: string[] = [];
    let canOpen = true;
    try {
      vscode.env.openExternal = async (uri) => {
        opened.push(uri.toString());
        return canOpen;
      };
      vscode.window.showInputBox = async () => "browser-command-test-key";
      vscode.window.showErrorMessage = async (message: string) => {
        errors.push(message);
        return undefined;
      };

      await withConfiguration("baseUrl", scope, async () => {
        const extension = vscode.extensions.getExtension("tiohsa.redmine-client");
        assert.ok(extension);
        await extension.activate();
        await vscode.commands.executeCommand("redmine-client.setApiKey");

        const ticket = await openFixture(scope, "redmine-client-ticket-41.md");
        const comment = await openFixture(scope, "redmine-client-comment-update-42-99.md");
        const draft = await openFixture(scope, "redmine-client-new-comment-42.md");
        const newTicket = await openFixture(scope, "redmine-client-new-ticket.md");
        const foreign = await openFixture(`${scope}other/`, "redmine-client-ticket-41.md");

        const commands = await vscode.commands.getCommands();
        assert.ok(commands.includes(OPEN_COMMENT_IN_BROWSER_COMMAND));
        await withoutActiveEditor(async () => {
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND);
          assert.strictEqual(errors.at(-1), "Open a Redmine editor or select a ticket in Dashboard.");
        });

        await vscode.window.showTextDocument(ticket);
        try {
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, comment.uri);
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND);
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, draft.uri);
          await vscode.commands.executeCommand(OPEN_TICKET_IN_BROWSER_COMMAND, comment.uri);
          assert.deepStrictEqual(opened, [
            `${scope}issues/42#note-2`,
            `${scope}issues/41`,
            `${scope}issues/42`,
            `${scope}issues/42`,
          ]);
          assert.deepStrictEqual(requests, ["/redmine/issues/42.json?include=journals"]);

          const dashboardStore = new DashboardStateStore();
          dashboardStore.update({
            selectedTicketId: 42,
            comments: { loading: false, ticketId: 42, items: [
              { id: 123, noteIndex: 7, authorName: "User", body: "Test", editableByCurrentUser: false, hasUnsyncedEdit: false },
            ] },
          });
          const dashboard = new DashboardController({
            store: dashboardStore,
            notifyOperationStarted: () => undefined,
            notifySuccess: () => undefined,
            notifyError: () => undefined,
            notifyToast: () => undefined,
            onTicketsRefreshed: () => undefined,
          });
          try {
            const router = new DashboardMessageRouter(dashboard);
            await router.route({ type: "comment.openBrowser", requestId: "row", ticketId: 42, commentId: 123, noteIndex: 7 });
          } finally {
            dashboard.dispose();
          }
          assert.strictEqual(opened.at(-1), `${scope}issues/42#note-7`);
          assert.strictEqual(requests.length, 1);

          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, newTicket.uri);
          assert.strictEqual(errors.at(-1), "Cannot open an unsynced new ticket draft in the browser.");
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, foreign.uri);
          assert.strictEqual(errors.at(-1), "This editor belongs to another Redmine connection.");
          const missingComment = await openFixture(scope, "redmine-client-comment-update-42-123.md");
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, missingComment.uri);
          assert.strictEqual(errors.at(-1), "Could not locate the comment in Redmine.");
          assert.strictEqual(opened.length, 5);

          canOpen = false;
          await vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, ticket.uri);
          assert.strictEqual(errors.at(-1), "Failed to open browser.");
          assert.strictEqual(opened.length, 6);
          canOpen = true;

          const request = new Promise<http.ServerResponse>((resolve) => { onRequest = resolve; });
          const pending = vscode.commands.executeCommand(OPEN_IN_BROWSER_COMMAND, comment.uri);
          const response = await request;
          try {
            await withConfiguration("baseUrl", `${scope}switched/`, async () => {
              response.end(JSON.stringify({ issue: { id: 42, journals } }));
              await pending;
              assert.strictEqual(errors.at(-1), "The Redmine connection changed before opening the browser.");
              assert.strictEqual(opened.length, 6);
            });
          } finally {
            if (!response.writableEnded) {
              response.end("{}");
            }
            await pending;
          }
        } finally {
          await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          await vscode.commands.executeCommand("redmine-client.clearApiKey");
        }
      });
    } finally {
      vscode.env.openExternal = originalOpenExternal;
      vscode.window.showInputBox = originalInputBox;
      vscode.window.showErrorMessage = originalShowError;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

suite("ブラウザで開く Dashboard 選択", () => {
  test("パレットと旧コマンドが Dashboard の対象を解決し、コメント選択のキャンセルを受け付ける", async () => {
    const scope = "https://redmine.example/browser/";
    const store = new DashboardStateStore();
    store.update({
      selectedProject: { id: 1, name: "Project", identifier: "project" },
      selectedTicketId: 42,
      comments: { loading: false, ticketId: 42, items: [
        { id: 99, noteIndex: 3, authorName: "User", body: "Test", editableByCurrentUser: false, hasUnsyncedEdit: false },
      ] },
    });

    const originalRegister = vscode.commands.registerCommand;
    const subscriptions: vscode.Disposable[] = [];
    const fixtureCommand = (id: string) => `browser-command-fixture.${id}`;
    try {
      vscode.commands.registerCommand = (id, callback, thisArg) =>
        originalRegister(fixtureCommand(id), callback, thisArg);
      registerBrowserCommands({ subscriptions }, { dashboardProvider: { getStateSnapshot: () => store.getState() } });
    } finally {
      vscode.commands.registerCommand = originalRegister;
    }

    const originalOpen = vscode.env.openExternal;
    const originalQuickPick = vscode.window.showQuickPick;
    const opened: string[] = [];
    try {
      vscode.env.openExternal = async (uri) => {
        opened.push(uri.toString());
        return true;
      };
      await withConfiguration("baseUrl", scope, async () => {
        const run = (command: string) => vscode.commands.executeCommand(fixtureCommand(command));
        await withoutActiveEditor(async () => {
          await run(OPEN_IN_BROWSER_COMMAND);
          store.updateNested("comments", { selectedCommentId: 99 });
          await run(OPEN_IN_BROWSER_COMMAND);
        });
        await run("redmine-client.openProjectInBrowser");

        const editor = await openFixture(scope, "redmine-client-ticket-41.md");
        await vscode.window.showTextDocument(editor);
        try {
          await run(OPEN_IN_BROWSER_COMMAND);
          await run(OPEN_TICKET_IN_BROWSER_COMMAND);
        } finally {
          await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }

        Object.defineProperty(vscode.window, "showQuickPick", {
          configurable: true,
          writable: true,
          value: async (items: readonly vscode.QuickPickItem[]) => items[0],
        });
        await run(OPEN_COMMENT_IN_BROWSER_COMMAND);
        vscode.window.showQuickPick = async () => undefined;
        await run(OPEN_COMMENT_IN_BROWSER_COMMAND);
      });
      assert.deepStrictEqual(opened, [
        `${scope}issues/42`,
        `${scope}issues/42#note-3`,
        `${scope}projects/project`,
        `${scope}issues/41`,
        `${scope}issues/42`,
        `${scope}issues/42#note-3`,
      ]);
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      vscode.env.openExternal = originalOpen;
      vscode.window.showQuickPick = originalQuickPick;
    }
  });
});
