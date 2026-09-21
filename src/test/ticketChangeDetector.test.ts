import * as assert from "assert";
import type { TicketEditorContent } from "../views/ticketEditorContent";
import type { TicketDraftState } from "../views/ticketSaveTypes";
import { detectTicketChanges } from "../views/ticketSync/ticketChangeDetector";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const createDraft = (): TicketDraftState => ({
  ticketId: 1,
  baseSubject: "Title",
  baseDescription: "Body",
  baseMetadata: buildIssueMetadataFixture(),
  status: "Synced",
});

const createContent = (
  overrides: Partial<TicketEditorContent> = {},
): TicketEditorContent => ({
  subject: "Title",
  description: "Body",
  metadata: buildIssueMetadataFixture(),
  ...overrides,
});

suite("Ticket change detector", () => {
  test("baseとの完全一致と空subject fallbackは変更なしと判定する", () => {
    const draft = createDraft();

    assert.strictEqual(detectTicketChanges(draft, createContent()).hasChanges, false);
    assert.strictEqual(
      detectTicketChanges(draft, createContent({ subject: "" })).subjectChanged,
      false,
    );
  });

  test("descriptionの末尾改行と末尾空白を変更と判定する", () => {
    const draft = createDraft();

    assert.strictEqual(
      detectTicketChanges(draft, createContent({ description: "Body\n" })).descriptionChanged,
      true,
    );
    assert.strictEqual(
      detectTicketChanges(draft, createContent({ description: "Body " })).descriptionChanged,
      true,
    );
  });

  test("Sync対象metadataだけをmetadata変更と判定する", () => {
    const draft = createDraft();

    assert.strictEqual(
      detectTicketChanges(draft, createContent({
        metadata: buildIssueMetadataFixture({ priority: "High" }),
      })).metadataChanged,
      true,
    );
    assert.strictEqual(
      detectTicketChanges(draft, createContent({
        metadata: buildIssueMetadataFixture({ parent: 99 }),
      })).hasChanges,
      false,
    );
  });

  test("children作成要求を変更と判定する", () => {
    const changeState = detectTicketChanges(createDraft(), createContent({
      metadata: buildIssueMetadataFixture({ children: ["Child"] }),
    }));

    assert.strictEqual(changeState.childCreationRequested, true);
    assert.strictEqual(changeState.hasChanges, true);
  });
});
