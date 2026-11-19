import * as assert from "assert";
import {
  buildCommentCreateFileContent,
  buildCommentUpdateFileContent,
  extractCommentBody,
  hasCommentUpdateMetadataMarkers,
  parseCommentCreateFile,
} from "../views/commentUpdateFile";

suite("Comment Create Template (mode: comment-create)", () => {
  test("buildCommentCreateFileContent は mode: comment-create と issue_id のテンプレートを生成する", () => {
    const content = buildCommentCreateFileContent(42);
    assert.ok(content.startsWith("---\nmode: comment-create\nissue_id: 42\n---\n\n# "));
    assert.ok(content.includes("#42"));
    assert.ok(content.endsWith("\n\n"));
  });

  test("parseCommentCreateFile は issueId と本文を抽出し、見出し行を除外する", () => {
    const template = buildCommentCreateFileContent(15);
    const parsedEmpty = parseCommentCreateFile(template);
    assert.ok(parsedEmpty);
    assert.strictEqual(parsedEmpty.issueId, 15);
    assert.strictEqual(parsedEmpty.body, "");

    const withBody = `${template}Line 1\n\nLine 2`;
    const parsedWithBody = parseCommentCreateFile(withBody);
    assert.ok(parsedWithBody);
    assert.strictEqual(parsedWithBody.issueId, 15);
    assert.strictEqual(parsedWithBody.body, "Line 1\n\nLine 2");
  });

  test("parseCommentCreateFile は不正または別モードの文書で undefined を返す", () => {
    assert.strictEqual(parseCommentCreateFile("plain comment text"), undefined);
    assert.strictEqual(
      parseCommentCreateFile("---\nmode: comment-update\nissue_id: 15\ncomment_id: 9\n---\n\nbody"),
      undefined,
    );
    assert.strictEqual(
      parseCommentCreateFile("---\nmode: comment-create\nissue_id: 0\n---\n\nbody"),
      undefined,
    );
  });

  test("extractCommentBody は comment-create・comment-update・プレーンテキストすべてから本文を返す", () => {
    const createContent = `${buildCommentCreateFileContent(3)}Hello Redmine`;
    assert.strictEqual(extractCommentBody(createContent), "Hello Redmine");

    const updateContent = buildCommentUpdateFileContent(
      { issueId: 3, journalId: 100, sourceNotesHash: "abc123" },
      "Updated body",
    );
    assert.strictEqual(extractCommentBody(updateContent), "Updated body");

    assert.strictEqual(extractCommentBody("Plain draft body"), "Plain draft body");
  });

  test("hasCommentUpdateMetadataMarkers は mode: comment-create を誤認しない", () => {
    const createContent = `${buildCommentCreateFileContent(7)}Comment body`;
    assert.strictEqual(hasCommentUpdateMetadataMarkers(createContent), false);
    assert.strictEqual(
      hasCommentUpdateMetadataMarkers("---\nmode: comment-update\nissue_id: 7\njournal_id: 1\n---\n"),
      true,
    );
  });
});
