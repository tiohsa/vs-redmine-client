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
  test("空のステータスでもエラーにならない", async () => {
    await assert.doesNotReject(() =>
      resolveMetadataForCreate({ ...baseMetadata, status: "" }, baseDeps, 1),
    );
  });

  test("空のステータスでは statusId をセットしない", async () => {
    const fields = await resolveMetadataForCreate(
      { ...baseMetadata, status: "" },
      baseDeps,
      1,
    );
    assert.strictEqual(fields.statusId, undefined);
  });

  test("空白のみのステータスでも statusId をセットしない", async () => {
    const fields = await resolveMetadataForCreate(
      { ...baseMetadata, status: "   " },
      baseDeps,
      1,
    );
    assert.strictEqual(fields.statusId, undefined);
  });

  test("有効なステータスを指定すると statusId がセットされる", async () => {
    const fields = await resolveMetadataForCreate(
      { ...baseMetadata, status: "In Progress" },
      baseDeps,
      1,
    );
    assert.strictEqual(fields.statusId, 1);
  });

  test("無効なステータスを指定するとエラーになる", async () => {
    await assert.rejects(
      () =>
        resolveMetadataForCreate(
          { ...baseMetadata, status: "存在しないステータス" },
          baseDeps,
          1,
        ),
      /Unknown status: 存在しないステータス/,
    );
  });

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
