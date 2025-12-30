import * as path from "path";

const normalizeToken = (value: string): string => value.trim().toLowerCase();

export const isProjectNameMatch = (fileName: string, projectName: string): boolean => {
  const normalizedProjectName = normalizeToken(projectName);
  if (normalizedProjectName.length === 0) {
    return false;
  }

  const baseName = normalizeToken(path.parse(fileName).name);
  return baseName.includes(normalizedProjectName);
};
