import * as assert from "assert";
import * as vscode from "vscode";
import { createTicketFromEditor } from "../commands/createTicket";
import { clearOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createMutableEditorStub } from "./helpers/editorStubs";
import { runWithConnectionScope } from "../redmine/client";

const scope = "https://create-command.example/";

suite("createTicketFromEditor durable sync boundary guard (RT-03)", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearOfflineSyncQueue(scope);
  });

  teardown(() => {
    clearOfflineSyncQueue(scope);
  });

  test("RT-03: createTicketFromEditor は直接 createIssue を呼ばず TicketSyncService / SyncEngine を経由する", async () => {
    await runWithConnectionScope(scope, async () => {
      let syncEditorCalled = false;
      let syncedProjectId: number | undefined;

      const uri = vscode.Uri.parse("file:///tmp/create-from-editor.md");
      const editor = createMutableEditorStub(uri, "Initial Editor Body");

      await createTicketFromEditor({
        getActiveEditor: () => editor,
        getDefaultProjectId: () => "50",
        promptSubject: async () => "Mock Ticket Subject",
        promptAttachments: async () => [],
        createTicketSyncService: () => ({
          syncEditor: async (input) => {
            syncEditorCalled = true;
            syncedProjectId = input.projectId;
            return { kind: "completed", ticketId: 777 };
          },
        }),
      });

      assert.strictEqual(syncEditorCalled, true, "TicketSyncService.syncEditor が呼ばれたこと");
      assert.strictEqual(syncedProjectId, 50, "指定したプロジェクトIDが渡されたこと");
    });
  });
});
