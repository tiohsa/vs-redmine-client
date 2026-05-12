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
      include_children: true,
      limit: 50,
      offset: 0,
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
      include_children: false,
      limit: 25,
      offset: 0,
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
      include_children: false,
      limit: 25,
      offset: 0,
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
      set_filter: 1,
      "f[]": "subject",
      "op[subject]": "~",
      "v[subject][]": "login bug",
      status_id: "*",
    });
  });
});
