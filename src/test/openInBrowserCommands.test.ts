import * as assert from "assert";
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
