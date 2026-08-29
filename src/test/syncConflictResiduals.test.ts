import * as assert from "assert";
import * as vscode from "vscode";
import { performSyncOnSave } from "../app/saveSyncExecutor";
import { createSyncEngine } from "../app/syncEngine";
import { createSyncController } from "../app/syncController";
import type { NotificationController } from "../app/notificationController";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "../app/presentationPorts";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { computeNotesHash } from "../utils/notesHash";
import { clearCommentEdits, initializeCommentEdit } from "../views/commentEditStore";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import {
  forceCommentSaveLocal,
  forceSaveLocal,
  handleConflict,
} from "../views/conflictResolver";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  rebaseOfflineTicketUpdateAfterConflictAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
} from "../views/offlineSyncStore";
import { clearTicketDrafts, initializeTicketDraft } from "../views/ticketDraftStore";
import {
  clearRegistry,
  registerCommentDocument,
  registerTicketEditor,
} from "../views/ticketEditorRegistry";
import { createMutableEditorStub, createTicketContentFixture } from "./helpers/editorStubs";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

const scope = getCurrentConnectionScope();

const makeNoopPresentation = (): TicketPresentationPort &
  CommentPresentationPort &
  UnsyncedPresentationPort => ({
    refresh: () => undefined,
    notifyChange: () => undefined,
    refreshForTicket: () => undefined,
    updateTicketSubject: () => undefined,
    setSelectedProjectId: async () => undefined,
  });

suite("sync conflict residuals", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    clearCommentEdits();
    clearRegistry();
    await clearOfflineSyncQueueAsync(scope);
  });

  teardown(async () => {
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    clearCommentEdits();
    clearRegistry();
    await clearOfflineSyncQueueAsync(scope);
  });

  test("auto Ticket Update conflict は可視 editor の resolver へ渡す", async () => {
    const ticketId = 301;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(
      ticketId,
      "Base subject",
      "Base body",
      metadata,
      "2026-08-26T00:00:00Z",
      scope,
    );
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/project-1_ticket-301.md"),
      createTicketContentFixture("Local subject", "Local body", { status: "New" }),
    );
    registerTicketEditor(ticketId, editor, "primary", "ticket", 1, scope);

    const ticketNotifications: string[] = [];
    let resolverCalls = 0;
    const presentation = makeNoopPresentation();
    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: presentation,
      commentsPresentation: presentation,
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: (result) => {
          if (result) {
            ticketNotifications.push(result.status);
          }
        },
        notifyCommentSaveResult: () => undefined,
      } as NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: {
        syncOne: async () => ({
          kind: "conflict",
          ticketId,
          message: "Remote changed",
          conflictContext: {
            ticketId,
            baseSubject: "Base subject",
            baseDescription: "Base body",
            localSubject: "Local subject",
            localDescription: "Local body",
            remoteSubject: "Remote subject",
            remoteDescription: "Remote body",
            remoteMetadata: metadata,
            remoteUpdatedAt: "2026-08-26T01:00:00Z",
          },
        }),
      },
      resolveTicketConflict: async (result, resolvedEditor) => {
        resolverCalls += 1;
        assert.strictEqual(resolvedEditor, editor);
        assert.strictEqual(result.conflictContext?.remoteSubject, "Remote subject");
        return { status: "merged", message: "Ticket conflict resolved" };
      },
    });

    assert.strictEqual(resolverCalls, 1);
    assert.strictEqual(ticketNotifications.at(-1), "merged");
  });

  test("auto Comment Update conflict は comment context を resolver へ渡す", async () => {
    const ticketId = 302;
    const commentId = 401;
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/redmine-client-comment-update-302-401.md"),
      "Local comment body",
    );
    registerCommentDocument(ticketId, commentId, editor.document, 1, scope);
    initializeCommentEdit(
      commentId,
      ticketId,
      "Base comment body",
      "2026-08-26T00:00:00Z",
      scope,
    );

    const commentNotifications: string[] = [];
    let resolverCalls = 0;
    let refreshCalls = 0;
    const presentation = makeNoopPresentation();
    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: presentation,
      commentsPresentation: {
        ...presentation,
        refreshForTicket: (resolvedTicketId) => {
          assert.strictEqual(resolvedTicketId, ticketId);
          refreshCalls += 1;
        },
      },
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: (result) => {
          if (result) {
            commentNotifications.push(result.status);
          }
        },
      } as NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: {
        syncOne: async () => ({
          kind: "conflict",
          ticketId,
          commentId,
          message: "Remote comment changed",
          commentConflictContext: {
            ticketId,
            commentId,
            baseBody: "Base comment body",
            localBody: "Local comment body",
            remoteBody: "Remote comment body",
            remoteUpdatedAt: "2026-08-26T01:00:00Z",
          },
        }),
      },
      resolveCommentConflict: async (result, resolvedEditor) => {
        resolverCalls += 1;
        assert.strictEqual(resolvedEditor, editor);
        assert.strictEqual(result.conflictContext?.remoteBody, "Remote comment body");
        return { status: "merged", message: "Comment conflict resolved" };
      },
    });

    assert.strictEqual(resolverCalls, 1);
    assert.strictEqual(commentNotifications.at(-1), "merged");
    assert.ok(refreshCalls >= 1);
  });

  test("Ticket local priority は atomic rebase 後に共有 SyncEngine を直接使う", async () => {
    const ticketId = 313;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/project-1_ticket-313.md"),
      createTicketContentFixture("Local", "Local body", { status: "New" }),
    );
    initializeTicketDraft(ticketId, "Base", "Base body", metadata, "t1", scope);
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      subject: "Local",
      description: "Local body",
      metadata,
      content: editor.document.getText(),
      baseSubject: "Base",
      baseDescription: "Base body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      connectionScope: scope,
      operationId: `ticket:${ticketId}`,
      phase: "queued",
      revision: 2,
    }, scope);
    const expected = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.ok(expected);
    let syncCalls = 0;

    const result = await forceSaveLocal({
      ticketId,
      baseSubject: "Base",
      baseDescription: "Base body",
      localSubject: "Local",
      localDescription: "Local body",
      remoteSubject: "Remote",
      remoteDescription: "Remote body",
      remoteMetadata: metadata,
      remoteUpdatedAt: "t2",
    }, editor, scope, {
      syncOne: async (key, context) => {
        syncCalls += 1;
        assert.deepStrictEqual(key, { kind: "ticket", ticketId });
        assert.strictEqual(context.connectionScope, scope);
        const rebased = getOfflineSyncQueue(scope).tickets.get(ticketId);
        assert.strictEqual(rebased?.revision, 3);
        assert.strictEqual(rebased?.intentRevision, 3);
        assert.strictEqual(rebased?.lastKnownRemoteUpdatedAt, "t2");
        return { kind: "completed", ticketId };
      },
    }, {
      operationId: expected!.operationId,
      revision: expected!.revision,
      content: expected!.content,
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(syncCalls, 1);
  });

  test("Comment local priority は expected snapshot を atomic rebase して共有 SyncEngine を使う", async () => {
    const ticketId = 314;
    const commentId = 407;
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, scope);
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/redmine-client-comment-update-314-407.md"),
      "Local comment body",
    );
    initializeCommentEdit(commentId, ticketId, "Base comment body", "t1", scope);
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody: "Base comment body",
      body: "Local comment body",
      lastKnownRemoteUpdatedAt: "t1",
      documentUri: editor.document.uri.toString(),
      connectionScope: scope,
      operationId: `comment:${commentId}`,
      phase: "queued",
      revision: 4,
    }, scope);
    const expected = getOfflineSyncQueue(scope).comments.find(
      (entry) => entry.commentId === commentId,
    );
    assert.ok(expected);
    let syncCalls = 0;

    const result = await forceCommentSaveLocal({
      ticketId,
      commentId,
      baseBody: "Base comment body",
      baseBodyKnown: true,
      localBody: "Local comment body",
      remoteBody: "Remote comment body",
      remoteUpdatedAt: "t2",
    }, editor, scope, {
      syncOne: async (key, context) => {
        syncCalls += 1;
        assert.strictEqual(key.kind, "comment");
        assert.strictEqual(context.connectionScope, scope);
        const rebased = getOfflineSyncQueue(scope).comments.find(
          (entry) => entry.commentId === commentId,
        );
        assert.strictEqual(rebased?.revision, 5);
        assert.strictEqual(rebased?.intentRevision, 5);
        assert.strictEqual(rebased?.baseBody, "Remote comment body");
        assert.strictEqual(rebased?.lastKnownRemoteUpdatedAt, "t2");
        assert.strictEqual(rebased?.sourceNotesHash, computeNotesHash("Remote comment body"));
        return { kind: "completed", ticketId, commentId };
      },
    }, {
      operationId: expected!.operationId,
      revision: expected!.revision,
      body: expected!.body,
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(syncCalls, 1);
    initializeOfflineSyncStore(memento, scope);
    const restored = getOfflineSyncQueue(scope).comments.find(
      (entry) => entry.commentId === commentId,
    );
    assert.strictEqual(restored?.revision, 5);
    assert.strictEqual(restored?.intentRevision, 5);
    assert.strictEqual(restored?.baseBody, "Remote comment body");
    assert.strictEqual(restored?.lastKnownRemoteUpdatedAt, "t2");
  });

  test("Comment Update handler は resolver に必要な三者の本文を conflict Outcome に保持する", async () => {
    const ticketId = 303;
    const commentId = 402;
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody: "Base comment body",
      body: "Local comment body",
      sourceNotesHash: computeNotesHash("Base comment body"),
      documentUri: "file:///tmp/comment-303-402.md",
    }, scope);
    const engine = createSyncEngine({
      comments: {
        getIssueDetail: async () => ({
          ticket: {
            id: ticketId,
            subject: "Ticket",
            projectId: 1,
            updatedAt: "2026-08-26T01:00:00Z",
          },
          comments: [{
            id: commentId,
            ticketId,
            authorId: 1,
            authorName: "Tester",
            body: "Remote comment body",
            updatedAt: "2026-08-26T01:00:00Z",
            editableByCurrentUser: true,
          }],
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId, commentId },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "conflict");
    if (outcome.kind !== "conflict") {
      assert.fail("comment conflict が必要です");
    }
    assert.ok("commentConflictContext" in outcome);
    assert.deepStrictEqual(
      "commentConflictContext" in outcome ? outcome.commentConflictContext : undefined,
      {
      ticketId,
      commentId,
      baseBody: "Base comment body",
      baseBodyKnown: true,
      localBody: "Local comment body",
      remoteBody: "Remote comment body",
      remoteUpdatedAt: "2026-08-26T01:00:00Z",
      },
    );
  });

  test("atomic rebase は再起動後も revision と remote base を復元する", async () => {
    const ticketId = 304;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, scope);
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      subject: "Local subject",
      description: "Local body",
      metadata,
      content: "Local body",
      baseSubject: "Base subject",
      baseDescription: "Base body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      connectionScope: scope,
      operationId: `ticket:${ticketId}`,
      phase: "queued",
      revision: 7,
    }, scope);

    const rebased = await rebaseOfflineTicketUpdateAfterConflictAsync(ticketId, {
      baseSubject: "Remote subject",
      baseDescription: "Remote body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t2",
    }, scope);
    assert.strictEqual(rebased?.revision, 8);
    assert.strictEqual(rebased?.intentRevision, 8);

    initializeOfflineSyncStore(memento, scope);
    const restored = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.strictEqual(restored?.revision, 8);
    assert.strictEqual(restored?.intentRevision, 8);
    assert.strictEqual(restored?.baseSubject, "Remote subject");
    assert.strictEqual(restored?.baseDescription, "Remote body");
    assert.strictEqual(restored?.lastKnownRemoteUpdatedAt, "t2");
  });

  test("dialog 待機中に operation が queued を離れた場合は rebase しない", async () => {
    const ticketId = 305;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const operationId = `ticket:${ticketId}`;
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      subject: "Local subject",
      description: "Local body",
      metadata,
      content: "Local body",
      baseSubject: "Base subject",
      baseDescription: "Base body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      connectionScope: scope,
      operationId,
      phase: "queued",
      revision: 1,
    }, scope);
    const preparing = await transitionOfflineTicketUpdateLifecycleAsync(
      ticketId,
      { kind: "begin_preparation" },
      scope,
      { operationId, revision: 1, sourcePhase: "queued" },
    );
    assert.strictEqual(preparing?.phase, "preparing");

    const rebased = await rebaseOfflineTicketUpdateAfterConflictAsync(ticketId, {
      baseSubject: "Remote subject",
      baseDescription: "Remote body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t2",
    }, scope);

    assert.strictEqual(rebased, undefined);
    const unchanged = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.strictEqual(unchanged?.phase, "preparing");
    assert.strictEqual(unchanged?.revision, 1);
    assert.strictEqual(unchanged?.baseSubject, "Base subject");
    assert.strictEqual(unchanged?.lastKnownRemoteUpdatedAt, "t1");
  });

  test("Comment Update handler は timestamp 競合でも三者の本文を保持する", async () => {
    const ticketId = 306;
    const commentId = 403;
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody: "Base timestamp body",
      body: "Local timestamp body",
      lastKnownRemoteUpdatedAt: "2026-08-26T00:00:00Z",
    }, scope);
    const engine = createSyncEngine({
      comments: {
        getIssueDetail: async () => ({
          ticket: { id: ticketId, subject: "Ticket", projectId: 1 },
          comments: [{
            id: commentId,
            ticketId,
            authorId: 1,
            authorName: "Tester",
            body: "Remote timestamp body",
            updatedAt: "2026-08-26T01:00:00Z",
            editableByCurrentUser: true,
          }],
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId, commentId },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "conflict");
    assert.ok(outcome.kind === "conflict" && "commentConflictContext" in outcome);
    if (outcome.kind !== "conflict" || !("commentConflictContext" in outcome)) {
      assert.fail("timestamp conflict context が必要です");
    }
    assert.strictEqual(outcome.commentConflictContext?.baseBody, "Base timestamp body");
    assert.strictEqual(outcome.commentConflictContext?.localBody, "Local timestamp body");
    assert.strictEqual(outcome.commentConflictContext?.remoteBody, "Remote timestamp body");
  });

  test("Comment Update は hash 一致でも timestamp が進んでいれば競合にする", async () => {
    const ticketId = 315;
    const commentId = 408;
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody: "Base body",
      body: "Local body",
      sourceNotesHash: computeNotesHash("Base body"),
      lastKnownRemoteUpdatedAt: "t1",
    }, scope);
    const engine = createSyncEngine({
      comments: {
        getIssueDetail: async () => ({
          ticket: { id: ticketId, subject: "Ticket", projectId: 1 },
          comments: [{
            id: commentId,
            ticketId,
            authorId: 1,
            authorName: "Tester",
            body: "Base body",
            updatedAt: "t2",
            editableByCurrentUser: true,
          }],
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId, commentId },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "conflict");
  });

  test("同じ revision でも dialog 待機中に内容が変われば古い rebase callback を拒否する", async () => {
    const ticketId = 307;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const operationId = `ticket:${ticketId}`;
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      subject: "Local subject A",
      description: "Local body A",
      metadata,
      content: "Local content A",
      baseSubject: "Base subject",
      baseDescription: "Base body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      connectionScope: scope,
      operationId,
      phase: "queued",
      revision: 1,
    }, scope);
    const shownOperation = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.ok(shownOperation);

    await addOfflineTicketUpdateAsync(ticketId, {
      ...shownOperation!,
      subject: "Local subject B",
      description: "Local body B",
      content: "Local content B",
    }, scope);
    const rejected = await rebaseOfflineTicketUpdateAfterConflictAsync(ticketId, {
      baseSubject: "Remote subject",
      baseDescription: "Remote body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t2",
    }, scope, {
      operationId: shownOperation!.operationId,
      revision: shownOperation!.revision,
      content: shownOperation!.content,
    });

    assert.strictEqual(rejected, undefined);
    const current = getOfflineSyncQueue(scope).tickets.get(ticketId);
    assert.strictEqual(current?.content, "Local content B");
    assert.strictEqual(current?.baseSubject, "Base subject");
    assert.strictEqual(current?.lastKnownRemoteUpdatedAt, "t1");
  });

  test("editor 不在の auto ticket conflict は自動解決せず通知と queue を保持する", async () => {
    const ticketId = 308;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(ticketId, "Base", "Base body", metadata, "t1", scope);
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/project-1_ticket-308.md"),
      createTicketContentFixture("Local", "Local body", { status: "New" }),
    );
    registerTicketEditor(ticketId, editor, "primary", "ticket", 1, scope);
    const notifications: string[] = [];
    let resolverCalls = 0;
    const presentation = makeNoopPresentation();

    await performSyncOnSave(editor.document, undefined, {
      ticketsPresentation: presentation,
      commentsPresentation: presentation,
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: (result) => {
          if (result) {
            notifications.push(result.status);
          }
        },
        notifyCommentSaveResult: () => undefined,
      },
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: {
        syncOne: async () => ({
          kind: "conflict",
          ticketId,
          message: "Remote changed",
          conflictContext: {
            ticketId,
            baseSubject: "Base",
            baseDescription: "Base body",
            localSubject: "Local",
            localDescription: "Local body",
            remoteSubject: "Remote",
            remoteDescription: "Remote body",
            remoteMetadata: metadata,
            remoteUpdatedAt: "t2",
          },
        }),
      },
      resolveTicketConflict: async (result) => {
        resolverCalls += 1;
        return result;
      },
    });

    assert.strictEqual(resolverCalls, 0);
    assert.strictEqual(notifications.at(-1), "conflict");
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.has(ticketId), true);
  });

  test("handleConflict は dialog 表示時の snapshot で local priority を fence する", async () => {
    const ticketId = 310;
    const metadata = buildIssueMetadataFixture({ status: "New" });
    const editor = createMutableEditorStub(
      vscode.Uri.parse("file:///tmp/project-1_ticket-310.md"),
      "Local content A",
    );
    initializeTicketDraft(ticketId, "Base", "Base body", metadata, "t1", scope);
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      subject: "Local A",
      description: "Local body A",
      metadata,
      content: "Local content A",
      baseSubject: "Base",
      baseDescription: "Base body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      connectionScope: scope,
      operationId: `ticket:${ticketId}`,
      phase: "queued",
      revision: 1,
    }, scope);

    const result = await handleConflict({
      status: "conflict",
      message: "Remote changed",
      conflictContext: {
        ticketId,
        baseSubject: "Base",
        baseDescription: "Base body",
        localSubject: "Local A",
        localDescription: "Local body A",
        remoteSubject: "Remote",
        remoteDescription: "Remote body",
        remoteMetadata: metadata,
        remoteUpdatedAt: "t2",
      },
    }, editor, {
      showConflictDialog: async () => {
        const current = getOfflineSyncQueue(scope).tickets.get(ticketId);
        assert.ok(current);
        await addOfflineTicketUpdateAsync(ticketId, {
          ...current!,
          subject: "Local B",
          description: "Local body B",
          content: "Local content B",
        }, scope);
        return "local";
      },
      forceSaveLocal: async (context, _editor, operationScope, _syncService, expected) => {
        const rebased = await rebaseOfflineTicketUpdateAfterConflictAsync(ticketId, {
          baseSubject: context.remoteSubject,
          baseDescription: context.remoteDescription,
          baseMetadata: context.remoteMetadata,
          lastKnownRemoteUpdatedAt: context.remoteUpdatedAt,
        }, operationScope, expected);
        return rebased
          ? { status: "success", message: "unexpected rebase" }
          : { status: "conflict", message: "stale callback rejected", conflictContext: context };
      },
      applyRemoteContent: async () => ({ status: "success", message: "unused" }),
      mergeTicketContent: async () => ({ status: "merged", message: "unused" }),
    }, scope);

    assert.strictEqual(result.status, "conflict");
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.content, "Local content B");
  });

  test("editor 不在の auto comment conflict は comment 通知へフォールバックする", async () => {
    const ticketId = 311;
    const commentId = 405;
    const uri = vscode.Uri.parse(`file:///tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`);
    const document = {
      uri,
      getText: () => buildCommentUpdateFileContent({
        issueId: ticketId,
        journalId: commentId,
        sourceNotesHash: computeNotesHash("Base"),
      }, "Local"),
    } as vscode.TextDocument;
    const ticketNotifications: string[] = [];
    const commentNotifications: string[] = [];
    const presentation = makeNoopPresentation();

    await performSyncOnSave(document, undefined, {
      ticketsPresentation: presentation,
      commentsPresentation: presentation,
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: (result) => {
          if (result) {
            ticketNotifications.push(result.status);
          }
        },
        notifyCommentSaveResult: (result) => {
          if (result) {
            commentNotifications.push(result.status);
          }
        },
      },
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: {
        syncOne: async () => ({
          kind: "conflict",
          ticketId,
          commentId,
          message: "Remote comment changed",
          commentConflictContext: {
            ticketId,
            commentId,
            baseBody: "Base",
            localBody: "Local",
            remoteBody: "Remote",
          },
        }),
      },
    });

    assert.deepStrictEqual(ticketNotifications, []);
    assert.strictEqual(commentNotifications.at(-1), "conflict");
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 1);
  });

  test("SyncController は注入された engine を auto 保存へ渡す", async () => {
    const ticketId = 309;
    const commentId = 404;
    const uri = vscode.Uri.parse(`file:///tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`);
    const document = {
      uri,
      getText: () => buildCommentUpdateFileContent({
        issueId: ticketId,
        journalId: commentId,
        sourceNotesHash: computeNotesHash("Base"),
      }, "Local"),
    } as vscode.TextDocument;
    let syncCalls = 0;
    const presentation = makeNoopPresentation();
    const controller = createSyncController({
      ticketsPresentation: presentation,
      commentsPresentation: presentation,
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: () => undefined,
      },
      registerEditorDocument: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: {
        syncOne: async () => {
          syncCalls += 1;
          return { kind: "no_change", ticketId, commentId };
        },
      },
    });

    controller.syncOnSave(document);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(syncCalls, 1);
  });

  test("SyncController は engine 注入後も manual 保存で remote write を開始しない", async () => {
    const ticketId = 312;
    const commentId = 406;
    const uri = vscode.Uri.parse(`file:///tmp/redmine-client-comment-update-${ticketId}-${commentId}.md`);
    const document = {
      uri,
      getText: () => buildCommentUpdateFileContent({
        issueId: ticketId,
        journalId: commentId,
        sourceNotesHash: computeNotesHash("Base"),
      }, "Local"),
    } as vscode.TextDocument;
    let syncCalls = 0;
    const presentation = makeNoopPresentation();
    const controller = createSyncController({
      ticketsPresentation: presentation,
      commentsPresentation: presentation,
      unsyncedPresentation: presentation,
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: () => undefined,
      },
      registerEditorDocument: () => undefined,
      offlineSyncMode: "manual",
      syncEngine: {
        syncOne: async () => {
          syncCalls += 1;
          return { kind: "completed", ticketId, commentId };
        },
      },
    });

    controller.syncOnSave(document);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(syncCalls, 0);
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 1);
  });
});
