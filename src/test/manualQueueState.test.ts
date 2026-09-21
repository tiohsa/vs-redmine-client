import * as assert from "assert";
import * as vscode from "vscode";
import { updateTicketDraftStatusFromDocument } from "../app/editorEventController";
import {
  addOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeDraftStore,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { queueTicketDraft } from "../views/ticketSaveSync";
import { clearRegistry, registerTicketDocument } from "../views/ticketEditorRegistry";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createMutableDocumentStub } from "./helpers/editorStubs";
import { createTestMemento } from "./helpers/vscodeMemento";

const TICKET_ID = 702;
const SCOPE = "manual-queue-state";
const metadata = buildIssueMetadataFixture();

const content = (subject: string, description: string): string => buildTicketEditorContent({
  subject,
  description,
  metadata,
});

const seedDraft = () => {
  initializeDraftStore(createInMemoryDraftStorage(), SCOPE);
  initializeTicketDraft(TICKET_ID, "Remote", "Body", metadata, undefined, SCOPE);
};

const seedQueue = async (
  queuedContent: string,
  phase: "queued" | "commit_unknown" = "queued",
): Promise<void> => {
  await addOfflineTicketUpdateAsync(TICKET_ID, {
    ticketId: TICKET_ID,
    baseSubject: "Remote",
    baseDescription: "Body",
    baseMetadata: metadata,
    subject: "Queued",
    description: "Queued body",
    metadata,
    content: queuedContent,
    operationId: SCOPE + ":ticket:" + TICKET_ID,
    connectionScope: SCOPE,
    phase,
    revision: 1,
    intentRevision: 1,
  }, SCOPE);
};

suite("manual queue state", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    seedDraft();
  });

  teardown(() => {
    clearRegistry();
    clearTicketDrafts();
  });

  test("queued snapshotとの一致は Queued、追加編集は Dirty、queueへ戻すと Queued", async () => {
    const original = content("Remote", "Body");
    const queued = content("Queued", "Queued body");
    const document = createMutableDocumentStub(
      vscode.Uri.parse("untitled:redmine-client-ticket-" + TICKET_ID + ".md"),
      queued,
    );
    registerTicketDocument(TICKET_ID, document, "ticket", undefined, SCOPE);
    await seedQueue(queued);

    document.setText(content("Newer", "Newer body"));
    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(TICKET_ID, SCOPE)?.status, "Dirty");

    document.setText(queued);
    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(TICKET_ID, SCOPE)?.status, "Queued");

    document.setText(original);
    assert.strictEqual(updateTicketDraftStatusFromDocument(document), true);
    assert.strictEqual(getTicketDraft(TICKET_ID, SCOPE)?.status, "Dirty");
  });

  test("manual saveでremote baseへ戻した場合はqueueをCAS取消してSyncedに戻す", async () => {
    const queued = content("Queued", "Queued body");
    await seedQueue(queued);

    const queuedResult = await queueTicketDraft({
      ticketId: TICKET_ID,
      content: queued,
      operationScope: SCOPE,
    });
    assert.strictEqual(queuedResult.status, "queued");
    assert.strictEqual(getTicketDraft(TICKET_ID, SCOPE)?.status, "Queued");

    const revertedResult = await queueTicketDraft({
      ticketId: TICKET_ID,
      content: content("Remote", "Body"),
      operationScope: SCOPE,
    });
    assert.strictEqual(revertedResult.status, "no_change");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(TICKET_ID), false);
    assert.strictEqual(getTicketDraft(TICKET_ID, SCOPE)?.status, "Synced");
  });

  test("commit_unknown queueはremote baseへ戻しても自動取消しない", async () => {
    const queued = content("Queued", "Queued body");
    await seedQueue(queued, "commit_unknown");

    const result = await queueTicketDraft({
      ticketId: TICKET_ID,
      content: content("Remote", "Body"),
      operationScope: SCOPE,
    });
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(TICKET_ID)?.phase, "commit_unknown");
  });
});
