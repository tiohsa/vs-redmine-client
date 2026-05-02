import * as assert from "assert";
import {
  parseFrontmatterControlFields,
  serializeFrontmatterControlFields,
} from "../views/ticketMetadataYaml";
import {
  withNewTicketControlFields,
  withRegisteredTicketControlFields,
} from "../views/ticketControlFields";
import { buildNewTicketDraftContent } from "../views/ticketDraftStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket control fields – issue_id parse/serialize", () => {
  test("parses empty issue_id: as null", () => {
    const result = parseFrontmatterControlFields("issue_id:");
    assert.strictEqual(result.issue_id, null);
  });

  test("parses issue_id: with whitespace as null", () => {
    const result = parseFrontmatterControlFields("issue_id:   ");
    assert.strictEqual(result.issue_id, null);
  });

  test("parses issue_id: 12345 as number", () => {
    const result = parseFrontmatterControlFields("issue_id: 12345");
    assert.strictEqual(result.issue_id, 12345);
  });

  test("serializes null issue_id as 'issue_id:'", () => {
    const result = serializeFrontmatterControlFields({ issue_id: null });
    assert.strictEqual(result, "issue_id:");
  });

  test("serializes numeric issue_id as 'issue_id: <id>'", () => {
    const result = serializeFrontmatterControlFields({ issue_id: 9999 });
    assert.strictEqual(result, "issue_id: 9999");
  });

  test("does not emit issue_id when undefined", () => {
    const result = serializeFrontmatterControlFields({ mode: "new-ticket" });
    assert.ok(!result.includes("issue_id"));
  });
});

suite("Ticket control fields – helper functions", () => {
  test("withNewTicketControlFields returns mode new-ticket and null issue_id", () => {
    const fields = withNewTicketControlFields();
    assert.strictEqual(fields.mode, "new-ticket");
    assert.strictEqual(fields.issue_id, null);
    assert.strictEqual(fields.project_id, undefined);
  });

  test("withNewTicketControlFields includes project_id when provided", () => {
    const fields = withNewTicketControlFields(42);
    assert.strictEqual(fields.project_id, 42);
    assert.strictEqual(fields.issue_id, null);
  });

  test("withRegisteredTicketControlFields sets ticket-update, issue_id, last_synced_at", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", project_id: 10, issue_id: null, draft_id: "abc-123" },
      9876,
    );
    assert.strictEqual(fields.mode, "ticket-update");
    assert.strictEqual(fields.issue_id, 9876);
    assert.strictEqual(fields.draft_id, undefined);
    assert.ok(typeof fields.last_synced_at === "string");
    assert.ok(fields.last_synced_at!.length > 0);
    assert.strictEqual(fields.project_id, 10);
  });

  test("withRegisteredTicketControlFields removes draft_id", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", draft_id: "some-uuid" },
      1,
    );
    assert.strictEqual(fields.draft_id, undefined);
  });

  test("withRegisteredTicketControlFields adds project_id when projectId argument is provided", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", issue_id: null },
      55,
      99,
    );
    assert.strictEqual(fields.project_id, 99);
    assert.strictEqual(fields.issue_id, 55);
    assert.strictEqual(fields.mode, "ticket-update");
  });

  test("withRegisteredTicketControlFields overrides existing project_id with provided projectId", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", issue_id: null, project_id: 10 },
      77,
      20,
    );
    assert.strictEqual(fields.project_id, 20);
  });

  test("withRegisteredTicketControlFields preserves existing project_id when no projectId argument", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", issue_id: null, project_id: 42 },
      100,
    );
    assert.strictEqual(fields.project_id, 42);
  });

  test("withRegisteredTicketControlFields with no project_id in existing and no argument omits project_id", () => {
    const fields = withRegisteredTicketControlFields(
      { mode: "new-ticket", issue_id: null },
      5,
    );
    assert.strictEqual(fields.project_id, undefined);
  });
});

suite("New ticket draft includes issue_id", () => {
  test("buildNewTicketDraftContent includes issue_id: null in control fields", () => {
    const content = buildNewTicketDraftContent();
    assert.strictEqual(content.controlFields?.mode, "new-ticket");
    assert.strictEqual(content.controlFields?.issue_id, null);
  });

  test("buildNewTicketDraftContent with projectId includes issue_id: null", () => {
    const content = buildNewTicketDraftContent({ projectId: 5 });
    assert.strictEqual(content.controlFields?.project_id, 5);
    assert.strictEqual(content.controlFields?.issue_id, null);
  });

  test("serialized new ticket content contains 'issue_id:'", () => {
    const content = buildNewTicketDraftContent({ projectId: 12 });
    const metadata = buildIssueMetadataFixture();
    const serialized = buildTicketEditorContent({
      ...content,
      subject: "New ticket",
      metadata,
    });
    assert.ok(serialized.includes("issue_id:"), `Expected 'issue_id:' in:\n${serialized}`);
    assert.ok(
      !serialized.match(/issue_id:\s*\d/),
      `Expected empty issue_id, got:\n${serialized}`,
    );
  });

  test("serialized new ticket content contains empty start_date", () => {
    const serialized = buildTicketEditorContent({
      ...buildNewTicketDraftContent({ projectId: 12 }),
      subject: "New ticket",
    });

    assert.ok(serialized.includes("  start_date: "), `Expected start_date in:\n${serialized}`);
  });

  test("round-trip: serialized empty issue_id parses back as null", () => {
    const content = buildNewTicketDraftContent({ projectId: 12 });
    const metadata = buildIssueMetadataFixture();
    const serialized = buildTicketEditorContent({
      ...content,
      subject: "Test",
      metadata,
    });
    const parsed = parseTicketEditorContent(serialized);
    assert.strictEqual(parsed.controlFields?.issue_id, null);
  });
});
