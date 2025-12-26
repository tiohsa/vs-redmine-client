import { requestJson } from "./client";
import { Project, RedmineProjectResponse } from "./types";

export const listProjects = async (includeChildren: boolean): Promise<Project[]> => {
  const response = await requestJson<RedmineProjectResponse>({
    method: "GET",
    path: "/projects.json",
    query: {
      include_children: includeChildren,
    },
  });

  return response.projects.map((project) => ({
    id: project.id,
    name: project.name,
    identifier: project.identifier,
    parentId: project.parent?.id,
  }));
};
