import * as assert from "assert";
import * as vscode from "vscode";
import { TicketSyncService } from "../app/ticketSync";
import {
  addOfflineNewTicketAsync,
  addOfflineTicketUpdate,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
} from "../views/ticketDraftStore";

const scope = "https://parity.example/";
const documentUri = "file:///tmp/parity.md";
const content = buildTicketEditorContent({
  subject: "Parity",
  description: "Body",
  metadata: buildIssueMetadataFixture(),
});

const editorFor = (editorContent: string): vscode.TextEditor => {
  let currentContent = editorContent;
  return {
    document: {
      uri: vscode.Uri.parse(documentUri),
      getText: () => currentContent,
    },
    edit: async (callback: (editBuilder: vscode.TextEditorEdit) => void) => {
      callback({
        replace: (_range: vscode.Range, replacement: string) => {
          currentContent = replacement;
        },
      } as vscode.TextEditorEdit);
      return true;
    },
  } as unknown as vscode.TextEditor;
};

suite("TicketSyncService entry-point parity", () => {
  for (const entryPoint of ["editor", "dashboard", "sync-one", "sync-all"] as const) {
    test(`${entryPoint}: remote-created operation は POST せず同じ postcondition になる`, async () => {
      initializeOfflineSyncStore(createTestMemento(), scope);
      const operation = await addOfflineNewTicketAsync({
        content,
        projectId: 7,
        documentUri,
        connectionScope: scope,
        createdIssueId: 700,
        phase: "local_finalize_pending",
      }, scope);
      let createCalls = 0;
      const service = new TicketSyncService({
        create: {
          createIssue: async () => {
            createCalls++;
            return 701;
          },
          deleteIssue: async () => undefined,
          listIssueStatuses: async () => [],
          listTrackers: async () => [],
          listIssuePriorities: async () => [],
          searchUsers: async () => [],
          uploadFile: async () => ({ token: "t", filename: "f", contentType: "text/plain" }),
          getIssueDetail: async () => ({
            ticket: {
              id: 700,
              subject: "Canonical",
              description: "Remote",
              projectId: 7,
              trackerName: "Task",
              priorityName: "Normal",
              statusName: "Closed",
              updatedAt: "t2",
            },
            comments: [],
          }),
        },
        documents: {
          rewriteNewTicket: async () => true,
          findOpenDocument: () => undefined,
        },
      });

      const outcome = entryPoint === "sync-all"
        ? (await service.syncAll({
          context: { connectionScope: scope },
          newTickets: [operation],
          tickets: [],
        }))[0]
        : entryPoint === "sync-one"
          ? await service.syncQueueItem({
            context: { connectionScope: scope },
            item: { kind: "newTicket", operation },
          })
          : await service.syncEditor({
            context: { connectionScope: scope },
            editor: editorFor(content),
            ticketId: 0,
            newTicket: true,
            manual: false,
            projectId: 7,
          });

      assert.strictEqual(outcome.kind, "completed");
      assert.strictEqual(createCalls, 0);
      assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 0);
    });
  }

  for (const entryPoint of ["editor", "dashboard", "sync-one", "sync-all"] as const) {
    test(`${entryPoint}: queued update は remote canonical draft + Markdown になる`, async () => {
      initializeOfflineSyncStore(createTestMemento(), scope);
      clearTicketDrafts(scope);
      const localMetadata = buildIssueMetadataFixture({ status: "In Progress" });
      initializeTicketDraft(800, "Local", "Old", localMetadata, undefined, scope);
      addOfflineTicketUpdate(800, {
        ticketId: 800,
        baseSubject: "Local",
        baseDescription: "Old",
        baseMetadata: localMetadata,
        subject: "Local",
        description: "Changed",
        metadata: localMetadata,
        documentUri,
        connectionScope: scope,
        phase: "queued",
      }, scope);
      const editorContent = buildTicketEditorContent({
        subject: "Local",
        description: "Changed",
        metadata: localMetadata,
        controlFields: {
          mode: "ticket-update",
          issue_id: 800,
          project_id: 7,
        },
      });
      let canonicalStatus: string | undefined;
      const service = new TicketSyncService({
        update: {
          updateIssue: async () => undefined,
          getIssueDetail: async () => ({
            ticket: {
              id: 800,
              subject: "Remote canonical",
              description: "Remote body",
              projectId: 7,
              trackerName: "Task",
              priorityName: "Normal",
              statusName: "Closed",
              updatedAt: "t2",
            },
            comments: [],
          }),
          listIssueStatuses: async () => [],
          listTrackers: async () => [],
          listIssuePriorities: async () => [],
          searchUsers: async () => [],
        },
        documents: {
          rewriteNewTicket: async () => true,
          rewriteTicket: async ({ replacement }) => {
            canonicalStatus = replacement.metadata.status;
            return true;
          },
          findOpenDocument: () => undefined,
        },
      });
      const operation = getOfflineSyncQueue(scope).tickets.get(800)!;

      const outcome = entryPoint === "sync-all"
        ? (await service.syncAll({
          context: { connectionScope: scope },
          newTickets: [],
          tickets: [operation],
        }))[0]
        : entryPoint === "sync-one"
          ? await service.syncQueueItem({
            context: { connectionScope: scope },
            item: { kind: "ticket", operation },
          })
          : await service.syncEditor({
            context: { connectionScope: scope },
            editor: editorFor(editorContent),
            ticketId: 800,
            newTicket: false,
            manual: false,
          });

      assert.strictEqual(outcome.kind, "completed");
      assert.strictEqual(canonicalStatus, "Closed");
      assert.strictEqual(getTicketDraft(800, scope)?.baseMetadata.status, "Closed");
      assert.strictEqual(getOfflineSyncQueue(scope).tickets.size, 0);
    });
  }
});
