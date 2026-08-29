import * as assert from "assert";
import { getCurrentConnectionScope } from "../config/connectionScope";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  rebaseOfflineTicketUpdateAfterConflictAsync,
  removeOfflineCommentEntryIfMatchesAsync,
  removeOfflineTicketUpdateIfMatchesAsync,
} from "../views/offlineSyncStore";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

const scope = getCurrentConnectionScope();

suite("sync conflict resolution CAS", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    await clearOfflineSyncQueueAsync(scope);
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync(scope);
  });

  test("current Attempt に committed Effect が残る queued ticket は rebase しない", async () => {
    const ticketId = 921;
    const metadata = buildIssueMetadataFixture();
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      baseSubject: "Base",
      baseDescription: "Base body",
      baseMetadata: metadata,
      subject: "Local",
      description: "Local body",
      metadata,
      content: "Local content",
      connectionScope: scope,
      operationId: `ticket:${ticketId}`,
      phase: "queued",
      revision: 3,
      intentRevision: 3,
      attemptGeneration: 2,
      effects: [{
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: 3,
        attemptGeneration: 2,
        state: "committed",
        target: { ticketId },
      }],
    }, scope);

    const rebased = await rebaseOfflineTicketUpdateAfterConflictAsync(ticketId, {
      baseSubject: "Remote",
      baseDescription: "Remote body",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t2",
    }, scope);

    assert.strictEqual(rebased, undefined);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.revision, 3);
  });

  test("ticket の stale merge/remote callback は同 revision の新しい content を削除しない", async () => {
    const ticketId = 922;
    const metadata = buildIssueMetadataFixture();
    await addOfflineTicketUpdateAsync(ticketId, {
      ticketId,
      baseSubject: "Base",
      baseDescription: "Base body",
      baseMetadata: metadata,
      subject: "Local A",
      description: "Local body A",
      metadata,
      content: "Local content A",
      connectionScope: scope,
      operationId: `ticket:${ticketId}`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
    }, scope);
    const shown = getOfflineSyncQueue(scope).tickets.get(ticketId)!;

    await addOfflineTicketUpdateAsync(ticketId, {
      ...shown,
      subject: "Local B",
      description: "Local body B",
      content: "Local content B",
    }, scope);
    const removed = await removeOfflineTicketUpdateIfMatchesAsync(ticketId, {
      operationId: shown.operationId,
      revision: shown.revision,
      intentRevision: shown.intentRevision,
      connectionScope: shown.connectionScope,
      content: shown.content,
    }, scope);

    assert.strictEqual(removed, false);
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.content, "Local content B");
  });

  test("comment の stale merge/remote callback は同 revision の新しい body を削除しない", async () => {
    const ticketId = 923;
    const commentId = 924;
    await addOfflineCommentUpdateAsync({
      ticketId,
      commentId,
      baseBody: "Base",
      body: "Local body A",
      connectionScope: scope,
      operationId: `comment:${commentId}`,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
    }, scope);
    const shown = getOfflineSyncQueue(scope).comments.find(
      (entry) => entry.commentId === commentId,
    )!;

    await addOfflineCommentUpdateAsync({ ...shown, body: "Local body B" }, scope);
    const removed = await removeOfflineCommentEntryIfMatchesAsync({
      ticketId,
      commentId,
    }, {
      operationId: shown.operationId,
      revision: shown.revision,
      intentRevision: shown.intentRevision,
      connectionScope: shown.connectionScope,
      body: shown.body,
    }, scope);

    assert.strictEqual(removed, false);
    assert.strictEqual(
      getOfflineSyncQueue(scope).comments.find((entry) => entry.commentId === commentId)?.body,
      "Local body B",
    );
  });
});
