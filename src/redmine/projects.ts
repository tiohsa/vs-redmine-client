import { requestJson, type RequestOptions } from "./client";
import { Project, RedmineProjectResponse } from "./types";

interface RedmineProjectDetailResponse {
  project: {
    id: number;
    name: string;
    trackers?: Array<{ id: number; name: string }>;
  };
}

const PROJECTS_PAGE_LIMIT = 100;
const MEMBERSHIPS_PAGE_LIMIT = 100;

interface RedmineMembershipsResponse {
  memberships: Array<{ user?: { id: number; name: string } }>;
  total_count?: number;
  limit?: number;
  offset?: number;
}

type RequestJson = <T>(options: RequestOptions) => Promise<T>;

const mapProjects = (
  raw: RedmineProjectResponse["projects"],
): Project[] =>
  raw.map((project) => ({
    id: project.id,
    name: project.name,
    identifier: project.identifier,
    parentId: project.parent?.id,
  }));

export const listProjects = async (includeChildren: boolean): Promise<Project[]> => {
  const first = await requestJson<RedmineProjectResponse>({
    method: "GET",
    path: "/projects.json",
    query: {
      include_children: includeChildren,
      limit: PROJECTS_PAGE_LIMIT,
      offset: 0,
    },
  });

  const all: Project[] = mapProjects(first.projects);
  const totalCount = first.total_count ?? all.length;

  // 2ページ目以降を並列取得
  if (totalCount > PROJECTS_PAGE_LIMIT) {
    const remainingOffsets: number[] = [];
    for (let offset = PROJECTS_PAGE_LIMIT; offset < totalCount; offset += PROJECTS_PAGE_LIMIT) {
      remainingOffsets.push(offset);
    }
    const pages = await Promise.all(
      remainingOffsets.map((offset) =>
        requestJson<RedmineProjectResponse>({
          method: "GET",
          path: "/projects.json",
          query: {
            include_children: includeChildren,
            limit: PROJECTS_PAGE_LIMIT,
            offset,
          },
        }),
      ),
    );
    for (const page of pages) {
      all.push(...mapProjects(page.projects));
    }
  }

  return all;
};

export const getProjectTrackers = async (
  projectId: number,
): Promise<Array<{ id: number; name: string }>> => {
  const response = await requestJson<RedmineProjectDetailResponse>({
    method: "GET",
    path: `/projects/${projectId}.json`,
    query: { include: "trackers" },
  });
  return response.project.trackers ?? [];
};

export const listProjectMembers = async (
  projectId: number,
  requester: RequestJson = requestJson,
): Promise<Array<{ id: number; name: string }>> => {
  const first = await requester<RedmineMembershipsResponse>({
    method: "GET",
    path: `/projects/${projectId}/memberships.json`,
    query: { limit: MEMBERSHIPS_PAGE_LIMIT, offset: 0 },
  });

  const memberships = [...first.memberships];
  const totalCount = first.total_count ?? memberships.length;
  const pageLimit = first.limit && first.limit > 0 ? first.limit : MEMBERSHIPS_PAGE_LIMIT;
  const firstOffset = first.offset ?? 0;
  const remainingOffsets: number[] = [];
  for (let offset = firstOffset + pageLimit; offset < totalCount; offset += pageLimit) {
    remainingOffsets.push(offset);
  }
  const pages = await Promise.all(
    remainingOffsets.map((offset) => requester<RedmineMembershipsResponse>({
      method: "GET",
      path: `/projects/${projectId}/memberships.json`,
      query: { limit: pageLimit, offset },
    })),
  );
  pages.forEach((page) => memberships.push(...page.memberships));

  const users = memberships
    .filter((m) => m.user !== undefined)
    .map((m) => m.user!);
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
};
