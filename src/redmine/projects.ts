import { requestJson } from "./client";
import { Project, RedmineProjectResponse } from "./types";

const PROJECTS_PAGE_LIMIT = 100;

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
