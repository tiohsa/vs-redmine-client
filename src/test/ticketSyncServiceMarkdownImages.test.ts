import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { TicketSyncService } from "../app/ticketSync/ticketSyncService";
import { TicketUpdateHandler } from "../app/ticketSync/operationHandlers";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { initializeOfflineSyncStore, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { initializeTicketDraft, clearTicketDrafts } from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import type { TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const createEditor = (filePath: string, initialContent: string): vscode.TextEditor => {
  let content = initialContent;
  return {
    document: {
      uri: vscode.Uri.file(filePath),
      getText: () => content,
    },
    edit: async (callback: (editBuilder: vscode.TextEditorEdit) => void) => {
      callback({
        replace: (_range: vscode.Range, replacement: string) => {
          content = replacement;
        },
      } as vscode.TextEditorEdit);
      return true;
    },
  } as unknown as vscode.TextEditor;
};

suite("TicketSyncService Markdown image uploads", () => {
  for (const { eol, resume, userEdit } of [
    { eol: "\n", resume: false, userEdit: false },
    { eol: "\r\n", resume: false, userEdit: false },
    { eol: "\r\n", resume: true, userEdit: false },
    { eol: "\r\n", resume: false, userEdit: true },
  ]) {
    test(`画像同期の実エディタ反映 (${eol === "\n" ? "LF" : "CRLF"}, 再開=${resume}, 途中編集=${userEdit})`, async () => {
      const scope = `https://redmine.example.org/image-editor-${eol.length}`;
      const memento = createTestMemento();
      initializeOfflineSyncStore(memento, scope);
      clearTicketDrafts(scope);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-image-editor-"));
      const uri = vscode.Uri.file(path.join(directory, "ticket.md"));
      const metadata = buildIssueMetadataFixture();
      const content = buildTicketEditorContent({
        subject: "Ticket",
        description: "![image](./screen.png)",
        metadata,
      }).replace(/\n/g, eol);
      fs.writeFileSync(path.join(directory, "screen.png"), "screen");
      fs.writeFileSync(uri.fsPath, content);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      initializeTicketDraft(903, "Ticket", "Old description", metadata, "t1", scope);
      let description = "Old description";
      let uploadCalls = 0;
      let updateCalls = 0;
      const textEditors = resume ? [] : [editor];
      const service = new TicketSyncService({
        rewrite: { textDocuments: [document], textEditors },
        update: {
          getIssueDetail: async () => ({
            ticket: {
              id: 903, projectId: 1, subject: "Ticket", description,
              trackerName: metadata.tracker, priorityName: metadata.priority,
              statusName: metadata.status, updatedAt: updateCalls ? "t2" : "t1",
            },
            comments: [],
          }),
          uploadFile: async () => {
            uploadCalls++;
            return { token: "image-token", filename: "remote.png", contentType: "image/png" };
          },
          updateIssue: async ({ fields }) => {
            updateCalls++;
            description = fields.description ?? description;
            if (userEdit) {
              await editor.edit((builder) => builder.insert(
                document.positionAt(document.getText().length), `${eol}同期中の追記`,
              ));
            }
          },
        },
      });
      try {
        let outcome = await service.syncEditor({
          context: { connectionScope: scope }, editor, ticketId: 903,
          newTicket: false, manual: false,
        });
        if (userEdit) {
          assert.strictEqual(outcome.kind, "remote_committed");
          assert.strictEqual(outcome.kind === "remote_committed" && outcome.pending, "local_finalize");
          assert.strictEqual(outcome.kind === "remote_committed" && outcome.message, "Editor rewrite pending: stale_source");
          assert.ok(document.getText().includes("![image](./screen.png)"));
          assert.ok(document.getText().endsWith("同期中の追記"));
          assert.strictEqual(uploadCalls, 1);
          assert.strictEqual(updateCalls, 1);
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(903)?.phase, "local_finalize_pending");
          return;
        }
        if (resume) {
          assert.strictEqual(outcome.kind, "remote_committed");
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(903)?.phase, "local_finalize_pending");
          initializeOfflineSyncStore(memento, scope);
          textEditors.push(editor);
          outcome = await service.syncQueueItem({ kind: "ticket", ticketId: 903 }, { connectionScope: scope });
        }
        assert.strictEqual(outcome.kind, "completed", JSON.stringify(outcome));
        assert.strictEqual(uploadCalls, 1);
        assert.strictEqual(updateCalls, 1);
        assert.ok(document.getText().includes("![image](remote.png)"));
        assert.strictEqual(document.eol, eol === "\n" ? vscode.EndOfLine.LF : vscode.EndOfLine.CRLF);
        assert.strictEqual(getOfflineSyncQueue(scope).tickets.size, 0);
        assert.strictEqual(fs.readFileSync(uri.fsPath, "utf8"), document.getText());
      } finally {
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        fs.rmSync(directory, { recursive: true, force: true });
        clearTicketDrafts(scope);
      }
    });
  }

  test("production entry point uploads one unique image and sends the rewritten update", async () => {
    const scope = "https://redmine.example.org/ticket-sync-markdown-images";
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-sync-mdimg-"));
    const imagePath = path.join(directory, "screen.png");
    const documentPath = path.join(directory, "ticket.md");
    fs.writeFileSync(imagePath, "screen");
    const metadata = buildIssueMetadataFixture();
    const content = buildTicketEditorContent({
      subject: "Ticket",
      description: "![a](./screen.png)\n![b](./screen.png)",
      metadata,
    });
    const editor = createEditor(documentPath, content);
    initializeTicketDraft(900, "Ticket", "Old description", metadata, "t1", scope);

    let uploadCalls = 0;
    let updateCalls = 0;
    let updateFields: Record<string, unknown> | undefined;
    let remoteDescription = "Old description";
    const service = new TicketSyncService({
      update: {
        getIssueDetail: async () => ({
          ticket: {
            id: 900,
            subject: "Ticket",
            description: remoteDescription,
            projectId: 1,
            trackerName: "Task",
            priorityName: "Normal",
            statusName: "In Progress",
            updatedAt: remoteDescription === "Old description" ? "t1" : "t2",
          },
          comments: [],
        }),
        updateIssue: async ({ fields }) => {
          updateCalls++;
          updateFields = fields as Record<string, unknown>;
          remoteDescription = String(fields.description ?? remoteDescription);
        },
        uploadFile: async () => {
          uploadCalls++;
          return {
            token: "screen-token",
            filename: "screen-redmine.png",
            contentType: "image/png",
          };
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => editor.document,
      },
    });

    const outcome = await service.syncEditor({
      context: { connectionScope: scope },
      editor,
      ticketId: 900,
      newTicket: false,
      manual: false,
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(uploadCalls, 1, "同一ローカル画像は一度だけ upload すること");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(
      updateFields?.description,
      "![a](screen-redmine.png)\n![b](screen-redmine.png)",
    );
    assert.deepStrictEqual(updateFields?.uploads, [
      { token: "screen-token", filename: "screen-redmine.png", content_type: "image/png" },
    ]);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.size, 0);
  });

  test("committed image effect is reused after prepare/secondary restart", async () => {
    const scope = "https://redmine.example.org/ticket-sync-markdown-images-restart";
    initializeOfflineSyncStore(createTestMemento(), scope);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-sync-mdimg-restart-"));
    const imagePath = path.join(directory, "screen.png");
    fs.writeFileSync(imagePath, "screen");

    const intent: TicketUpdateIntent = {
      ticketId: 901,
      baseSubject: "Ticket",
      baseDescription: "Old description",
      baseMetadata: buildIssueMetadataFixture(),
      subject: "Ticket",
      description: "![screen](./screen.png)",
      metadata: buildIssueMetadataFixture(),
      baseDir: directory,
    };
    const repository = createSyncOperationRepository();
    const key = { kind: "ticket" as const, ticketId: 901 };
    await repository.saveOperation({
      operationId: `${scope}:ticket:901`,
      kind: "ticket_update",
      key,
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      persistenceVersion: 1,
      ticketId: 901,
      intent,
    }, scope);

    let uploadCalls = 0;
    const uploadFile = async () => {
      uploadCalls++;
      return { token: "restart-token", filename: "screen-redmine.png", contentType: "image/png" };
    };
    const handler = new TicketUpdateHandler();
    const context = { connectionScope: scope };
    const deps = { repository, ticketUpdate: { uploadFile } } as any;

    const first = repository.getOperation<TicketUpdateIntent>(key, scope)!;
    const prepared1 = await handler.prepare(first, context, deps);
    assert.strictEqual(prepared1.ok, true);
    const secondary1 = await handler.executeSecondaryEffects!(first, prepared1.ok ? prepared1.prepared : undefined!, context, deps);
    assert.strictEqual(secondary1.ok, true);

    const afterRestart = repository.getOperation<TicketUpdateIntent>(key, scope)!;
    const prepared2 = await handler.prepare(afterRestart, context, deps);
    assert.strictEqual(prepared2.ok, true);
    const secondary2 = await handler.executeSecondaryEffects!(afterRestart, prepared2.ok ? prepared2.prepared : undefined!, context, deps);
    assert.strictEqual(secondary2.ok, true);
    assert.strictEqual(uploadCalls, 1);
    assert.deepStrictEqual(secondary2.ok ? secondary2.uploadTokens : undefined, [
      { token: "restart-token", filename: "screen-redmine.png", content_type: "image/png" },
    ]);
  });

  test("production update path rejects an image outside the editor base directory", async () => {
    const scope = "https://redmine.example.org/ticket-sync-markdown-images-sandbox";
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);

    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-sync-mdimg-sandbox-"));
    const baseDir = path.join(parentDir, "editor");
    fs.mkdirSync(baseDir);
    fs.writeFileSync(path.join(parentDir, "secret.png"), "secret");
    const documentPath = path.join(baseDir, "ticket.md");
    const metadata = buildIssueMetadataFixture();
    const editor = createEditor(
      documentPath,
      buildTicketEditorContent({
        subject: "Ticket",
        description: "![secret](../secret.png)",
        metadata,
      }),
    );
    initializeTicketDraft(902, "Ticket", "Old description", metadata, undefined, scope);

    let uploadCalls = 0;
    let updateCalls = 0;
    const service = new TicketSyncService({
      update: {
        uploadFile: async () => {
          uploadCalls++;
          return { token: "unexpected", filename: "secret.png", contentType: "image/png" };
        },
        updateIssue: async () => {
          updateCalls++;
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => editor.document,
      },
    });

    const outcome = await service.syncEditor({
      context: { connectionScope: scope },
      editor,
      ticketId: 902,
      newTicket: false,
      manual: false,
    });

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(uploadCalls, 0);
    assert.strictEqual(updateCalls, 0);
  });
});
