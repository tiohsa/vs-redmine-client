import * as assert from "assert";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
  markDraftStatus,
  updateDraftAfterSave,
} from "../views/ticketDraftStore";

suite("Ticket draft store", () => {
  teardown(() => {
    clearTicketDrafts();
  });

  test("initializes and updates draft state", () => {
    initializeTicketDraft(10, "Subject", "Body", "2024-01-01T00:00:00Z");

    const draft = getTicketDraft(10);
    assert.ok(draft);
    assert.strictEqual(draft?.baseSubject, "Subject");
    assert.strictEqual(draft?.baseDescription, "Body");
    assert.strictEqual(draft?.lastKnownRemoteUpdatedAt, "2024-01-01T00:00:00Z");
    assert.strictEqual(draft?.status, "clean");

    markDraftStatus(10, "conflict");
    assert.strictEqual(getTicketDraft(10)?.status, "conflict");

    updateDraftAfterSave(10, "Next", "Next Body", "2024-01-02T00:00:00Z");
    const updated = getTicketDraft(10);
    assert.strictEqual(updated?.baseSubject, "Next");
    assert.strictEqual(updated?.baseDescription, "Next Body");
    assert.strictEqual(updated?.lastKnownRemoteUpdatedAt, "2024-01-02T00:00:00Z");
    assert.strictEqual(updated?.status, "clean");
  });
});
