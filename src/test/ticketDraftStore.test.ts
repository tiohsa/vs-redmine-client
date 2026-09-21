import * as assert from "assert";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
  initializeDraftStore,
  markDraftStatus,
  setTicketDraftContent,
  updateDraftAfterSave,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket draft store", () => {
  teardown(() => {
    clearTicketDrafts();
    initializeDraftStore(createInMemoryDraftStorage());
  });

  test("initializes and updates draft state", () => {
    initializeTicketDraft(
      10,
      "Subject",
      "Body",
      buildIssueMetadataFixture(),
      "2024-01-01T00:00:00Z",
    );

    const draft = getTicketDraft(10);
    assert.ok(draft);
    assert.strictEqual(draft?.baseSubject, "Subject");
    assert.strictEqual(draft?.baseDescription, "Body");
    assert.strictEqual(draft?.lastKnownRemoteUpdatedAt, "2024-01-01T00:00:00Z");
    assert.strictEqual(draft?.status, "Synced");

    markDraftStatus(10, "Conflict");
    assert.strictEqual(getTicketDraft(10)?.status, "Conflict");

    updateDraftAfterSave(
      10,
      "Next",
      "Next Body",
      buildIssueMetadataFixture({ priority: "High" }),
      "2024-01-02T00:00:00Z",
    );
    const updated = getTicketDraft(10);
    assert.strictEqual(updated?.baseSubject, "Next");
    assert.strictEqual(updated?.baseDescription, "Next Body");
    assert.strictEqual(updated?.lastKnownRemoteUpdatedAt, "2024-01-02T00:00:00Z");
    assert.strictEqual(updated?.status, "Synced");
  });

  test("同一ticket IDの下書きを接続スコープごとに分離する", () => {
    const scopeA = "https://a.example/redmine/";
    const scopeB = "https://b.example/redmine/";
    initializeDraftStore(createInMemoryDraftStorage(), scopeA);
    initializeTicketDraft(10, "A", "Body A", buildIssueMetadataFixture(), undefined, scopeA);
    initializeDraftStore(createInMemoryDraftStorage(), scopeB);
    initializeTicketDraft(10, "B", "Body B", buildIssueMetadataFixture(), undefined, scopeB);

    markDraftStatus(10, "Dirty", scopeA);

    assert.strictEqual(getTicketDraft(10, scopeA)?.baseSubject, "A");
    assert.strictEqual(getTicketDraft(10, scopeA)?.status, "Dirty");
    assert.strictEqual(getTicketDraft(10, scopeB)?.baseSubject, "B");
    assert.strictEqual(getTicketDraft(10, scopeB)?.status, "Synced");
    clearTicketDrafts(scopeA);
    clearTicketDrafts(scopeB);
  });

  test("Syncと同じ差分意味論でEditor snapshotを保持またはclearする", () => {
    const metadata = buildIssueMetadataFixture();
    initializeTicketDraft(11, "Subject", "Body", metadata);

    setTicketDraftContent(11, {
      subject: "Subject",
      description: "Body",
      metadata: buildIssueMetadataFixture({ parent: 99 }),
    });
    assert.strictEqual(getTicketDraft(11)?.draftMetadata, undefined);

    setTicketDraftContent(11, {
      subject: "Subject",
      description: "Body\n",
      metadata,
    });
    assert.strictEqual(getTicketDraft(11)?.draftDescription, "Body\n");

    setTicketDraftContent(11, {
      subject: "Subject",
      description: "Body",
      metadata: buildIssueMetadataFixture({ children: ["Child"] }),
    });
    assert.deepStrictEqual(getTicketDraft(11)?.draftMetadata?.children, ["Child"]);
  });
});
