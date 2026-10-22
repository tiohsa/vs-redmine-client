import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  CommentCreateHandler,
  CommentUpdateHandler,
  TicketUpdateHandler,
} from "../app/ticketSync/operationHandlers";
import { SyncCoordinator, type SyncCoordinatorOptions } from "../app/ticketSync/syncCoordinator";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type {
  CommentCreateIntent,
  CommentUpdateIntent,
  TicketUpdateIntent,
  UnifiedSyncOperation,
} from "../app/ticketSync/syncOperationTypes";
import type { IssueDetailResult } from "../redmine/issues";
import { clearCommentEdits, getCommentEdit, initializeCommentEdit } from "../views/commentEditStore";
import {
  buildCommentUpdateFileContent,
  finalizeNewCommentDraftFileAfterSync,
  parseCommentUpdateFile,
} from "../views/commentUpdateFile";
import {
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  switchOfflineSyncStore,
} from "../views/offlineSyncStore";
import { clearRegistry, registerCommentDocument } from "../views/ticketEditorRegistry";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { computeNotesHash } from "../utils/notesHash";
import { createTicketContentFixture } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://local-finalization.example.org/";
const TICKET_ID = 611;
const COMMENT_ID = 712;
const ORIGINAL_BODY = "![image](./images/screen.png)";
const SENT_BODY = "![image](screen.png)";

const ticketOperation = (): UnifiedSyncOperation<TicketUpdateIntent> => ({
  operationId: "ticket:611",
  kind: "ticket_update",
  key: { kind: "ticket", ticketId: TICKET_ID },
  connectionScope: SCOPE,
  ticketId: TICKET_ID,
  phase: "local_finalize_pending",
  revision: 1,
  intentRevision: 1,
  attemptGeneration: 1,
  persistenceVersion: 1,
  documentUri: "file:///tmp/local-finalization-ticket.md",
  intent: {
    ticketId: TICKET_ID,
    baseSubject: "Base",
    baseDescription: "Base body",
    baseMetadata: buildIssueMetadataFixture(),
    subject: "Local subject",
    description: "Local body",
    metadata: buildIssueMetadataFixture(),
  },
});

const remoteDetail = (): IssueDetailResult => ({
  ticket: {
    id: TICKET_ID,
    projectId: 1,
    subject: "Canonical subject",
    description: "Canonical body",
    updatedAt: "2026-10-22T01:02:03Z",
  },
  comments: [{
    id: COMMENT_ID,
    ticketId: TICKET_ID,
    authorId: 1,
    authorName: "Author",
    body: SENT_BODY,
    updatedAt: "2026-10-22T01:02:03Z",
    editableByCurrentUser: true,
  }],
});

const commentOperation = (documentUri: string): UnifiedSyncOperation<CommentCreateIntent> => ({
  operationId: "comment-create:611",
  kind: "comment_create",
  key: { kind: "comment", ticketId: TICKET_ID, documentUri },
  connectionScope: SCOPE,
  ticketId: TICKET_ID,
  createdRemoteId: COMMENT_ID,
  projectId: 1,
  documentUri,
  phase: "local_finalize_pending",
  revision: 1,
  intentRevision: 1,
  attemptGeneration: 1,
  persistenceVersion: 1,
  intent: { ticketId: TICKET_ID, body: ORIGINAL_BODY, documentUri, finalizeDraft: true },
  effects: [{
    effectId: "comment-create",
    kind: "comment_create",
    operationRevision: 1,
    attemptGeneration: 1,
    state: "committed",
    target: { ticketId: TICKET_ID },
    remoteId: COMMENT_ID,
    requestSnapshot: {
      kind: "comment_create",
      request: { ticketId: TICKET_ID, notes: SENT_BODY },
      submittedBody: SENT_BODY,
    },
  }],
});

suite("sync local finalization recovery", () => {
  const openedDocuments: vscode.TextDocument[] = [];
  const directories: string[] = [];

  const openDocument = async (body: string, filename = "comment-draft.md"): Promise<vscode.TextDocument> => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sync-local-finalize-"));
    directories.push(directory);
    const file = path.join(directory, filename);
    fs.writeFileSync(file, body);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
    openedDocuments.push(document);
    return document;
  };

  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    clearCommentEdits();
    clearRegistry();
  });

  teardown(async () => {
    for (const document of openedDocuments.splice(0)) {
      if (!document.isClosed) {
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
    }
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    clearCommentEdits();
    clearRegistry();
    clearTicketDrafts(SCOPE);
    await clearOfflineSyncQueueAsync(SCOPE);
    switchOfflineSyncStore(getCurrentConnectionScope());
  });

  test("Ticket再開時のGET失敗と文書CAS失敗ではqueueを保持し、確定成功後だけ完了する", async () => {
    const operation = ticketOperation();
    const content = createTicketContentFixture("Local subject", "Local body");
    await addOfflineTicketUpdateAsync(TICKET_ID, {
      ticketId: TICKET_ID,
      baseSubject: "Base",
      baseDescription: "Base body",
      baseMetadata: buildIssueMetadataFixture(),
      subject: "Local subject",
      description: "Local body",
      metadata: buildIssueMetadataFixture(),
      content,
      documentUri: operation.documentUri,
      phase: "local_finalize_pending",
      effects: [{
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "committed",
        target: { ticketId: TICKET_ID },
        remoteId: TICKET_ID,
      }],
    }, SCOPE);
    let fetchFails = true;
    let documentIsStale = true;
    let rewriteCalls = 0;
    let remoteWrites = 0;
    const options: SyncCoordinatorOptions = {
      deps: {
        ticketUpdate: {
          getIssueDetail: async () => {
            if (fetchFails) { throw new Error("offline"); }
            return remoteDetail();
          },
          updateIssue: async () => { remoteWrites += 1; },
        },
        documents: {
          rewriteNewTicket: async () => ({ kind: "not_available" }),
          findOpenDocument: () => undefined,
          rewriteTicket: async (input) => {
            rewriteCalls += 1;
            assert.strictEqual(input.expected.content, content);
            assert.strictEqual(input.replacement.subject, "Canonical subject");
            return { kind: documentIsStale ? "stale_source" : "applied" };
          },
        },
      },
    };
    const coordinator = new SyncCoordinator();
    const key = { kind: "ticket" as const, ticketId: TICKET_ID };
    const first = await coordinator.sync(key, { connectionScope: SCOPE }, options);
    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(rewriteCalls, 0);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(TICKET_ID)?.phase, "local_finalize_pending");

    fetchFails = false;
    const second = await coordinator.sync(key, { connectionScope: SCOPE }, options);
    assert.strictEqual(second.kind, "remote_committed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(TICKET_ID), true);

    documentIsStale = false;
    const third = await coordinator.sync(key, { connectionScope: SCOPE }, options);
    assert.strictEqual(third.kind, "completed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(TICKET_ID), false);
    assert.strictEqual(rewriteCalls, 2);
    assert.strictEqual(remoteWrites, 0);
  });

  for (const canonical of [
    {},
    { ticket: { id: TICKET_ID + 1, projectId: 1, subject: "Other ticket" } },
    { ticket: { id: TICKET_ID, projectId: 1 } },
  ]) {
    test(`不正なTicket canonicalでは文書確定を省略して成功にしない: ${JSON.stringify(canonical)}`, async () => {
      const result = await new TicketUpdateHandler().finalizeLocal(
        ticketOperation(), canonical, { connectionScope: SCOPE },
      );
      assert.strictEqual(result.ok, false);
      if (!result.ok) { assert.strictEqual(result.pending, "local_finalize"); }
    });
  }

  test("画像付き新規コメントは送信本文をfile/hash/edit基準へ確定し、再実行しても成功する", async () => {
    const document = await openDocument(ORIGINAL_BODY);
    const operation = commentOperation(document.uri.toString());
    const handler = new CommentCreateHandler();
    assert.deepStrictEqual(await handler.finalizeLocal(operation, undefined, { connectionScope: SCOPE }), { ok: true });
    const parsed = parseCommentUpdateFile(document.getText());
    assert.strictEqual(parsed?.body, SENT_BODY);
    assert.strictEqual(parsed?.fields.sourceNotesHash, computeNotesHash(SENT_BODY));
    assert.strictEqual(getCommentEdit(COMMENT_ID, SCOPE)?.baseBody, SENT_BODY);
    const finalized = document.getText();
    assert.deepStrictEqual(await handler.finalizeLocal(operation, undefined, { connectionScope: SCOPE }), { ok: true });
    assert.strictEqual(document.getText(), finalized);
  });

  test("画像付き新規コメントの送信中の後続編集は保持し、再実行でも上書きしない", async () => {
    const newerBody = `${ORIGINAL_BODY}\nNew local edit`;
    const document = await openDocument(newerBody);
    const input = {
      documentUri: document.uri.toString(),
      ticketId: TICKET_ID,
      commentId: COMMENT_ID,
      expectedDocumentBody: ORIGINAL_BODY,
      syncedBody: SENT_BODY,
    };
    assert.strictEqual(await finalizeNewCommentDraftFileAfterSync(input), "applied");
    const finalized = document.getText();
    const parsed = parseCommentUpdateFile(finalized);
    assert.strictEqual(parsed?.body, newerBody);
    assert.strictEqual(parsed?.fields.sourceNotesHash, computeNotesHash(SENT_BODY));
    assert.strictEqual(await finalizeNewCommentDraftFileAfterSync(input), "applied");
    assert.strictEqual(document.getText(), finalized);
  });

  for (const body of [ORIGINAL_BODY, `${ORIGINAL_BODY}\nNew local edit`]) {
    test(`旧版が原文hashで確定したdraftも再開時に送信基準へ補正する: ${body}`, async () => {
      const document = await openDocument(buildCommentUpdateFileContent({
        issueId: TICKET_ID,
        journalId: COMMENT_ID,
        sourceNotesHash: computeNotesHash(ORIGINAL_BODY),
      }, body));
      const input = {
        documentUri: document.uri.toString(),
        ticketId: TICKET_ID,
        commentId: COMMENT_ID,
        expectedDocumentBody: ORIGINAL_BODY,
        syncedBody: SENT_BODY,
      };
      assert.strictEqual(await finalizeNewCommentDraftFileAfterSync(input), "applied");
      const parsed = parseCommentUpdateFile(document.getText());
      assert.strictEqual(parsed?.body, body === ORIGINAL_BODY ? SENT_BODY : body);
      assert.strictEqual(parsed?.fields.sourceNotesHash, computeNotesHash(SENT_BODY));
      assert.strictEqual(await finalizeNewCommentDraftFileAfterSync(input), "applied");
    });
  }

  test("draftの既存frontmatterが未知の基準hashなら補正せず保持する", async () => {
    const raw = buildCommentUpdateFileContent({
      issueId: TICKET_ID,
      journalId: COMMENT_ID,
      sourceNotesHash: computeNotesHash("Unrelated remote version"),
    }, ORIGINAL_BODY);
    const document = await openDocument(raw);
    const result = await finalizeNewCommentDraftFileAfterSync({
      documentUri: document.uri.toString(),
      ticketId: TICKET_ID,
      commentId: COMMENT_ID,
      expectedDocumentBody: ORIGINAL_BODY,
      syncedBody: SENT_BODY,
    });
    assert.strictEqual(result, "stale_source");
    assert.strictEqual(document.getText(), raw);
  });

  test("旧local priorityのhashを持つ通常コメントeditorも同一scope/identityなら確定できる", async () => {
    const document = await openDocument("Local body");
    registerCommentDocument(TICKET_ID, COMMENT_ID, document, 1, SCOPE);
    initializeCommentEdit(COMMENT_ID, TICKET_ID, "Base", undefined, SCOPE);
    const operation: UnifiedSyncOperation<CommentUpdateIntent> = {
      ...commentOperation(document.uri.toString()),
      kind: "comment_update",
      commentId: COMMENT_ID,
      nextIntent: undefined,
      intent: {
        ticketId: TICKET_ID,
        commentId: COMMENT_ID,
        body: "Local body",
        sourceNotesHash: computeNotesHash("Remote base"),
      },
    };
    const result = await new CommentUpdateHandler().finalizeLocal(operation, remoteDetail(), { connectionScope: SCOPE });
    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(getCommentEdit(COMMENT_ID, SCOPE)?.baseBody, SENT_BODY);
    assert.strictEqual(document.getText(), "Local body");
  });

  for (const entry of [
    { filename: "comment.md", body: "Local body", scope: "https://other.example.org/" },
    { filename: "redmine-client-comment-update-611-712.md", body: "Local body", scope: SCOPE },
    { filename: "comment.md", body: "---\nmode: comment-update\n---\nLocal body", scope: SCOPE },
  ]) {
    test(`旧hash互換処理は別scopeや壊れたupdate fileを通常editor扱いにしない: ${entry.filename}/${entry.scope}/${entry.body}`, async () => {
      const document = await openDocument(entry.body, entry.filename);
      registerCommentDocument(TICKET_ID, COMMENT_ID, document, 1, entry.scope);
      const operation: UnifiedSyncOperation<CommentUpdateIntent> = {
        ...commentOperation(document.uri.toString()),
        kind: "comment_update",
        commentId: COMMENT_ID,
        nextIntent: undefined,
        intent: {
          ticketId: TICKET_ID,
          commentId: COMMENT_ID,
          body: entry.body,
          sourceNotesHash: computeNotesHash("Remote base"),
        },
      };
      const result = await new CommentUpdateHandler().finalizeLocal(operation, remoteDetail(), { connectionScope: SCOPE });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(document.getText(), entry.body);
    });
  }
});
