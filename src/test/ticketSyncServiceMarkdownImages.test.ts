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
