import * as assert from "assert";
import {
  clearTicketDrafts,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { syncTicketDraft } from "../views/ticketSaveSync";

suite("Ticket save sync", () => {
  teardown(() => {
    clearTicketDrafts();
  });

  test("returns no_change when content matches base", async () => {
    initializeTicketDraft(1, "Title", "Body", "t1");

    const result = await syncTicketDraft({
      ticketId: 1,
      content: buildTicketEditorContent({ subject: "Title", description: "Body" }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 1, subject: "Title", projectId: 1, updatedAt: "t1" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("should not update");
        },
      },
    });

    assert.strictEqual(result.status, "no_change");
  });

  test("returns conflict when remote updated", async () => {
    initializeTicketDraft(2, "Title", "Body", "t1");

    const result = await syncTicketDraft({
      ticketId: 2,
      content: buildTicketEditorContent({ subject: "Title", description: "Updated" }),
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 2, subject: "Title", projectId: 1, updatedAt: "t2" },
          comments: [],
        }),
        updateIssue: async () => {
          throw new Error("should not update");
        },
      },
    });

    assert.strictEqual(result.status, "conflict");
  });

  test("returns unreachable on server error", async () => {
    initializeTicketDraft(3, "Title", "Body", "t1");

    const result = await syncTicketDraft({
      ticketId: 3,
      content: buildTicketEditorContent({ subject: "Title", description: "Updated" }),
      deps: {
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
        updateIssue: async () => {
          throw new Error("should not update");
        },
      },
    });

    assert.strictEqual(result.status, "unreachable");
  });

  test("updates when changes exist and no conflict", async () => {
    initializeTicketDraft(4, "Title", "Body", "t1");

    const updatedAtValues = ["t1", "t2"];
    const result = await syncTicketDraft({
      ticketId: 4,
      content: buildTicketEditorContent({ subject: "New", description: "Body" }),
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 4,
            subject: "Title",
            projectId: 1,
            updatedAt: updatedAtValues.shift(),
          },
          comments: [],
        }),
        updateIssue: async () => undefined,
      },
    });

    assert.strictEqual(result.status, "success");
  });
});
