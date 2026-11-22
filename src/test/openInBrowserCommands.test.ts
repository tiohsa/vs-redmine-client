import * as assert from "assert";
import { browserTargetForDashboard } from "../app/browserCommandTarget";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import {
  openCommentInBrowser,
  openProjectInBrowser,
  openTicketInBrowser,
} from "../commands/openInBrowser";

suite("Open in browser commands", () => {
  test("reports missing project identifier", async () => {
    const errors: string[] = [];
    await openProjectInBrowser(
      { project: { id: 1, name: "Name", identifier: "" } },
      {
        baseUrl: "https://example.com",
        onError: (message) => errors.push(message),
      },
    );

    assert.deepStrictEqual(errors, ["Project identifier is missing."]);
  });

  test("reports missing ticket id", async () => {
    const errors: string[] = [];
    await openTicketInBrowser(
      { ticket: { id: 0, subject: "Missing", projectId: 1 } },
      {
        baseUrl: "https://example.com",
        onError: (message) => errors.push(message),
      },
    );

    assert.deepStrictEqual(errors, ["Ticket ID is missing."]);
  });

  test("reports missing comment id", async () => {
    const errors: string[] = [];
    await openCommentInBrowser(
      {
        comment: {
          id: 0,
          ticketId: 12,
          authorId: 1,
          authorName: "User",
          body: "Test",
          editableByCurrentUser: false,
        },
      },
      {
        baseUrl: "https://example.com",
        onError: (message) => errors.push(message),
      },
    );

    assert.deepStrictEqual(errors, ["Comment ID is missing."]);
  });

  test("reports browser launch failure", async () => {
    const errors: string[] = [];
    await openProjectInBrowser(
      { project: { id: 1, name: "Name", identifier: "alpha" } },
      {
        baseUrl: "https://example.com",
        openExternal: async () => false,
        onError: (message) => errors.push(message),
      },
    );

    assert.deepStrictEqual(errors, ["Failed to open browser."]);
  });
});

suite("チケット・コメントのブラウザ対象", () => {
  test("Dashboard は選択中のチケットに属するコメントを優先する", () => {
    const state = new DashboardStateStore().getState();
    state.selectedTicketId = 42;
    state.comments = { loading: false, items: [], ticketId: 42, selectedCommentId: 99 };
    assert.deepStrictEqual(browserTargetForDashboard(state), { ticketId: 42, commentId: 99 });
    state.selectedTicketId = 43;
    assert.deepStrictEqual(browserTargetForDashboard(state), { ticketId: 43, commentId: undefined });
    state.selectedTicketId = undefined;
    assert.strictEqual(browserTargetForDashboard(state), undefined);
  });
});
