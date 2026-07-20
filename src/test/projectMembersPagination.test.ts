import * as assert from "assert";
import { listProjectMembers } from "../redmine/projects";
import type { RequestOptions } from "../redmine/client";

suite("Project member pagination", () => {
  test("uses the server page size and returns members beyond the first page", async () => {
    const offsets: number[] = [];
    const requester = async <T>(options: RequestOptions): Promise<T> => {
      const offset = Number(options.query?.offset ?? 0);
      offsets.push(offset);
      const response = {
        memberships: [
          { user: { id: offset + 1, name: `User ${offset + 1}` } },
          { user: { id: offset + 2, name: `User ${offset + 2}` } },
        ].slice(0, Math.max(0, 5 - offset)),
        total_count: 5,
        limit: 2,
        offset,
      };
      return response as T;
    };

    const members = await listProjectMembers(7, requester);

    assert.deepStrictEqual(offsets, [0, 2, 4]);
    assert.deepStrictEqual(members.map((member) => member.id), [1, 2, 3, 4, 5]);
  });
});
