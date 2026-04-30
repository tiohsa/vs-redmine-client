import * as assert from "assert";
import {
  buildCommentUpdateFilename,
  buildCommentUpdateFileContent,
  isCommentUpdateFilename,
  parseCommentUpdateFile,
} from "../views/commentUpdateFile";
import { computeNotesHash } from "../utils/notesHash";

suite("commentUpdateFile", () => {
  test("buildCommentUpdateFilename", () => {
    assert.strictEqual(
      buildCommentUpdateFilename(39, 123),
      "redmine-client-comment-update-39-123.md",
    );
  });

  test("isCommentUpdateFilename: matches", () => {
    assert.ok(isCommentUpdateFilename("redmine-client-comment-update-39-123.md"));
    assert.ok(isCommentUpdateFilename("redmine-client-comment-update-1-1.md"));
  });

  test("isCommentUpdateFilename: no match", () => {
    assert.ok(!isCommentUpdateFilename("project-1_ticket-2.md"));
    assert.ok(!isCommentUpdateFilename("redmine-client-new-ticket.md"));
    assert.ok(!isCommentUpdateFilename("comment-update-39-123.md"));
  });

  test("buildCommentUpdateFileContent: フロントマターと本文が正しく生成される", () => {
    const hash = computeNotesHash("body text");
    const content = buildCommentUpdateFileContent(
      {
        issueId: 39,
        journalId: 123,
        projectId: 1,
        projectName: "eCookbook",
        issueSubject: "I-P1-VIS",
        commentAuthor: "Tanaka",
        sourceNotesHash: hash,
      },
      "body text",
    );
    assert.ok(content.startsWith("---\n"));
    assert.ok(content.includes("mode: comment-update"));
    assert.ok(content.includes("issue_id: 39"));
    assert.ok(content.includes("journal_id: 123"));
    assert.ok(content.includes(`source_notes_hash: ${hash}`));
    assert.ok(content.endsWith("body text"));
  });

  test("parseCommentUpdateFile: 正常にパースできる", () => {
    const hash = computeNotesHash("hello");
    const raw = [
      "---",
      "mode: comment-update",
      "issue_id: 39",
      "journal_id: 123",
      `source_notes_hash: ${hash}`,
      "---",
      "",
      "hello",
    ].join("\n");

    const result = parseCommentUpdateFile(raw);
    assert.ok(result !== undefined);
    assert.strictEqual(result.fields.issueId, 39);
    assert.strictEqual(result.fields.journalId, 123);
    assert.strictEqual(result.fields.sourceNotesHash, hash);
    assert.strictEqual(result.body, "hello");
  });

  test("parseCommentUpdateFile: mode が異なると undefined", () => {
    const raw = [
      "---",
      "mode: ticket-update",
      "issue_id: 39",
      "journal_id: 123",
      "source_notes_hash: sha256:abc",
      "---",
      "",
      "body",
    ].join("\n");
    assert.strictEqual(parseCommentUpdateFile(raw), undefined);
  });

  test("parseCommentUpdateFile: フロントマターなしは undefined", () => {
    assert.strictEqual(parseCommentUpdateFile("just text"), undefined);
  });

  test("parseCommentUpdateFile: 必須フィールド欠損は undefined", () => {
    const raw = [
      "---",
      "mode: comment-update",
      "issue_id: 39",
      "---",
      "",
      "body",
    ].join("\n");
    assert.strictEqual(parseCommentUpdateFile(raw), undefined);
  });

  test("computeNotesHash: 同じ内容は同一ハッシュ", () => {
    const h1 = computeNotesHash("some text");
    const h2 = computeNotesHash("some text");
    assert.strictEqual(h1, h2);
    assert.ok(h1.startsWith("sha256:"));
  });

  test("computeNotesHash: 異なる内容は異なるハッシュ", () => {
    const h1 = computeNotesHash("text A");
    const h2 = computeNotesHash("text B");
    assert.notStrictEqual(h1, h2);
  });
});
