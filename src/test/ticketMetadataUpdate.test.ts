import * as assert from "assert";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { initializeTicketDraft, clearTicketDrafts } from "../views/ticketDraftStore";
import { syncTicketDraft } from "../views/ticketSaveSync";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket metadata update", () => {
  teardown(() => {
    clearTicketDrafts();
  });

  test("maps metadata changes into update fields", async () => {
    const baseMetadata = buildIssueMetadataFixture();
    initializeTicketDraft(20, "Title", "Body", baseMetadata, "t1");

    let updatedFields: unknown;
    const result = await syncTicketDraft({
      ticketId: 20,
      content: buildTicketEditorContent({
        subject: "Title",
        description: "Body",
        metadata: buildIssueMetadataFixture({ priority: "High", due_date: "" }),
      }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 20, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async ({ fields }) => {
          updatedFields = fields;
        },
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        listTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [
          { id: 3, name: "Normal" },
          { id: 4, name: "High" },
        ],
      },
    });

    assert.strictEqual(result.status, "success");
    assert.deepStrictEqual(updatedFields, {
      priorityId: 4,
      dueDate: null,
    });
  });
});
