import * as assert from "assert";
import { resolveMetadataForCreate } from "../views/ticketSync/ticketMetadataResolver";
import { IssueMetadata } from "../views/ticketMetadataTypes";

const baseMetadata: IssueMetadata = {
  tracker: "Task",
  priority: "Normal",
  status: "",
  due_date: "",
};

const baseDeps = {
  createIssue: async () => 1,
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
  listTrackers: async () => [{ id: 2, name: "Task" }],
  listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "t", filename: "f.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 2, name: "Task" }],
};

suite("resolveMetadataForCreate — status optional handling", () => {
  for (const status of ["", "   "]) {
    test(`空のステータス ${JSON.stringify(status)} は一覧を取得しない`, async () => {
      let calls = 0;
      const fields = await resolveMetadataForCreate({ ...baseMetadata, status }, {
        ...baseDeps,
        listIssueStatuses: async () => { calls++; throw new Error("HTTP 403"); },
      }, 1);
      assert.strictEqual(calls, 0);
      assert.strictEqual(fields.statusId, undefined);
    });
  }

  for (const status of ["In Progress", "存在しないステータス"]) {
    test(`指定ステータス ${status} は一覧を一度取得して解決する`, async () => {
      let calls = 0;
      const deps = { ...baseDeps, listIssueStatuses: async () => {
        calls++;
        return [{ id: 1, name: "In Progress" }];
      } };
      if (status === "In Progress") {
        const fields = await resolveMetadataForCreate({ ...baseMetadata, status }, deps, 1);
        assert.strictEqual(fields.statusId, 1);
      } else {
        await assert.rejects(() => resolveMetadataForCreate({ ...baseMetadata, status }, deps, 1),
          /Unknown status: 存在しないステータス/);
      }
      assert.strictEqual(calls, 1);
    });
  }

  test("statusId なしでも trackerId と priorityId はセットされる", async () => {
    const fields = await resolveMetadataForCreate(
      { ...baseMetadata, status: "" },
      baseDeps,
      1,
    );
    assert.strictEqual(fields.trackerId, 2);
    assert.strictEqual(fields.priorityId, 3);
  });
});
