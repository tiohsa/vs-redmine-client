import * as assert from "assert";
import { buildIssuesListQuery } from "../redmine/issues";

suite("Ticket list query", () => {
  test("builds query with required parameters", () => {
    const query = buildIssuesListQuery({
      projectId: 12,
      includeChildProjects: true,
      limit: 50,
      offset: 0,
      statusIds: ["1", "2"],
      assigneeIds: ["5"],
    });

    assert.deepStrictEqual(query, {
      project_id: 12,
      subproject_id: "*",
      limit: 50,
      offset: 0,
      sort: "id:asc",
      set_filter: 1,
      status_id: "1,2",
      assigned_to_id: "5",
    });
  });

  test("uses status_id=* when no statusIds are specified", () => {
    const query = buildIssuesListQuery({
      projectId: 5,
      includeChildProjects: false,
      limit: 25,
      offset: 0,
    });

    assert.deepStrictEqual(query, {
      project_id: 5,
      subproject_id: "!*",
      limit: 25,
      offset: 0,
      sort: "id:asc",
      set_filter: 1,
      status_id: "*",
    });
  });

  test("uses status_id=* when statusIds is an empty array", () => {
    const query = buildIssuesListQuery({
      projectId: 5,
      includeChildProjects: false,
      limit: 25,
      offset: 0,
      statusIds: [],
    });

    assert.deepStrictEqual(query, {
      project_id: 5,
      subproject_id: "!*",
      limit: 25,
      offset: 0,
      sort: "id:asc",
      set_filter: 1,
      status_id: "*",
    });
  });

  test("omits project filters for all-project searches", () => {
    const query = buildIssuesListQuery({
      includeChildProjects: true,
      limit: 25,
      offset: 0,
    });

    assert.deepStrictEqual(query, {
      limit: 25,
      offset: 0,
      sort: "id:asc",
      set_filter: 1,
      status_id: "*",
    });
  });

  test("builds Redmine subject filter query", () => {
    const query = buildIssuesListQuery({
      includeChildProjects: false,
      limit: 25,
      offset: 0,
      subjectQuery: "  login bug  ",
    });

    assert.deepStrictEqual(query, {
      limit: 25,
      offset: 0,
      subject: "~login bug",
      sort: "id:asc",
      set_filter: 1,
      status_id: "*",
    });
  });
});

suite("本文・番号検索のAPI条件", () => {
  test("本文フィルターとプロジェクト・終了状態・担当者条件を併用できる形式で送る", () => {
    const query = buildIssuesListQuery({ projectId: 8, includeChildProjects: false, limit: 50, offset: 50, descriptionQuery: " 日本語の文章 ", statusIds: ["2"], assigneeIds: ["7"] });
    assert.strictEqual(query.description, "~日本語の文章");
    assert.strictEqual(query.subproject_id, "!*");
    assert.strictEqual(query.status_id, "2");
    assert.strictEqual(query.assigned_to_id, "7");
    assert.strictEqual(query["f[]"], undefined, "短縮形式のフィルターを無効化するf[]を混在させない");
  });
  test("番号検索にも子プロジェクトを含む範囲と全ステータスを指定する", () => {
    const query = buildIssuesListQuery({ projectId: 8, includeChildProjects: true, limit: 50, offset: 0, issueIds: [123] });
    assert.strictEqual(query.issue_id, "123");
    assert.strictEqual(query.project_id, 8);
    assert.strictEqual(query.subproject_id, "*");
    assert.strictEqual(query.status_id, "*");
  });
});
