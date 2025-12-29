import * as assert from "assert";
import {
  buildCommentEditorFilename,
  buildTicketEditorFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";

suite("Editor filename builder", () => {
  test("builds stable ticket filename", () => {
    const filename = buildTicketEditorFilename(2, 10, "primary");

    assert.strictEqual(filename, "project-2_ticket-10.md");
  });

  test("builds stable extra ticket filename", () => {
    const filename = buildTicketEditorFilename(2, 10, "extra");

    assert.strictEqual(filename, "project-2_ticket-10_extra.md");
  });

  test("builds stable comment filename", () => {
    const filename = buildCommentEditorFilename(2, 10, 55);

    assert.strictEqual(filename, "project-2_ticket-10_comment-55.md");
  });

  test("parses ticket filename", () => {
    const parsed = parseEditorFilename("project-2_ticket-10.md");

    assert.deepStrictEqual(parsed, {
      type: "ticket",
      projectId: 2,
      ticketId: 10,
    });
  });

  test("parses extra ticket filename", () => {
    const parsed = parseEditorFilename("project-2_ticket-10_extra.md");

    assert.deepStrictEqual(parsed, {
      type: "ticket",
      projectId: 2,
      ticketId: 10,
    });
  });

  test("parses suffixed ticket filename", () => {
    const parsed = parseEditorFilename("project-2_ticket-10-7.md");

    assert.deepStrictEqual(parsed, {
      type: "ticket",
      projectId: 2,
      ticketId: 10,
    });
  });

  test("parses comment filename", () => {
    const parsed = parseEditorFilename("project-2_ticket-10_comment-55.md");

    assert.deepStrictEqual(parsed, {
      type: "comment",
      projectId: 2,
      ticketId: 10,
      commentId: 55,
    });
  });

  test("parses suffixed comment filename", () => {
    const parsed = parseEditorFilename("project-2_ticket-10_comment-55-3.md");

    assert.deepStrictEqual(parsed, {
      type: "comment",
      projectId: 2,
      ticketId: 10,
      commentId: 55,
    });
  });

  test("ignores unrelated filename", () => {
    const parsed = parseEditorFilename("notes.md");

    assert.strictEqual(parsed, undefined);
  });

  test("parses new comment draft filename", () => {
    const ticketId = parseNewCommentDraftFilename("redmine-client-new-comment-42.md");

    assert.strictEqual(ticketId, 42);
  });

  test("parses new comment draft filename with suffix", () => {
    const ticketId = parseNewCommentDraftFilename("redmine-client-new-comment-42-2.md");

    assert.strictEqual(ticketId, 42);
  });

  test("ignores unrelated new comment draft filename", () => {
    const ticketId = parseNewCommentDraftFilename("redmine-client-new-comment.md");

    assert.strictEqual(ticketId, undefined);
  });
});
