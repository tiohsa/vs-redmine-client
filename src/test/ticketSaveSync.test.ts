import * as assert from "assert";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeTicketDraft,
  setTicketDraftContent,
} from "../views/ticketDraftStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { reloadTicketEditor, syncTicketDraft } from "../views/ticketSaveSync";
import { createEditorStub } from "./helpers/editorStubs";
import * as vscode from "vscode";

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

  test("reload overwrites editor content with saved data", async () => {
    initializeTicketDraft(5, "Title", "Body", "t1");
    setTicketDraftContent(5, { subject: "Draft", description: "Draft Body" });
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-5.md"), "Draft");
    let applied = "";

    const result = await reloadTicketEditor({
      ticketId: 5,
      editor,
      deps: {
        getIssueDetail: async () => ({
          ticket: {
            id: 5,
            subject: "Reloaded",
            description: "New Body",
            projectId: 1,
            updatedAt: "t2",
          },
          comments: [],
        }),
        applyEditorContent: async (_editor, content) => {
          applied = content;
        },
      },
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(
      applied,
      buildTicketEditorContent({ subject: "Reloaded", description: "New Body" }),
    );
    const draft = getTicketDraft(5);
    assert.strictEqual(draft?.baseSubject, "Reloaded");
    assert.strictEqual(draft?.draftSubject, undefined);
  });

  test("reload keeps draft when fetch fails", async () => {
    initializeTicketDraft(6, "Title", "Body", "t1");
    setTicketDraftContent(6, { subject: "Draft", description: "Draft Body" });
    const editor = createEditorStub(vscode.Uri.parse("untitled:ticket-6.md"), "Draft");

    const result = await reloadTicketEditor({
      ticketId: 6,
      editor,
      deps: {
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (503): Service Unavailable");
        },
        applyEditorContent: async () => undefined,
      },
    });

    assert.strictEqual(result.status, "unreachable");
    const draft = getTicketDraft(6);
    assert.strictEqual(draft?.draftSubject, "Draft");
  });
});
