import * as assert from "assert";
import { buildNewTicketDraftContent } from "../views/ticketDraftStore";

suite("getProjectTrackers API レスポンス解析", () => {
  test("buildNewTicketDraftContent: initialValues でトラッカーを上書きできる", () => {
    const content = buildNewTicketDraftContent({
      projectId: 42,
      initialValues: {
        subject: "テスト件名",
        tracker: "Bug",
        priority: "High",
        status: "New",
        start_date: "2026-05-01",
        due_date: "2026-05-31",
        description: "初期説明",
      },
    });

    assert.strictEqual(content.subject, "テスト件名");
    assert.strictEqual(content.metadata.tracker, "Bug");
    assert.strictEqual(content.metadata.priority, "High");
    assert.strictEqual(content.metadata.status, "New");
    assert.strictEqual(content.metadata.start_date, "2026-05-01");
    assert.strictEqual(content.metadata.due_date, "2026-05-31");
    assert.strictEqual(content.description, "初期説明");
    assert.strictEqual(content.controlFields?.mode, "new-ticket");
    assert.strictEqual(content.controlFields?.project_id, 42);
  });

  test("buildNewTicketDraftContent: initialValues.parent が設定される", () => {
    const content = buildNewTicketDraftContent({
      projectId: 10,
      initialValues: {
        subject: "子チケット",
        tracker: "Task",
        priority: "Normal",
        status: "New",
        parent: 456,
      },
    });

    assert.strictEqual(content.metadata.parent, 456);
    assert.strictEqual(content.subject, "子チケット");
  });

  test("buildNewTicketDraftContent: initialValues なしはデフォルト値を使う", () => {
    const content = buildNewTicketDraftContent({ projectId: 99 });
    assert.strictEqual(content.controlFields?.mode, "new-ticket");
    assert.strictEqual(content.controlFields?.project_id, 99);
  });

  test("buildNewTicketDraftContent: 部分的な initialValues は他フィールドに影響しない", () => {
    const content = buildNewTicketDraftContent({
      projectId: 5,
      initialValues: { tracker: "Support" },
    });
    assert.strictEqual(content.metadata.tracker, "Support");
    assert.ok(content.metadata.priority !== undefined);
    assert.ok(content.metadata.status !== undefined);
  });
});
