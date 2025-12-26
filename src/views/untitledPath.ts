import * as path from "path";

type ExistsSync = (candidate: string) => boolean;

const appendSuffix = (filename: string, suffix: number): string => {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${filename}-${suffix}`;
  }

  const base = filename.slice(0, dotIndex);
  const ext = filename.slice(dotIndex);
  return `${base}-${suffix}${ext}`;
};

export const buildUniqueUntitledPath = (
  basePath: string,
  filename: string,
  existsSync: ExistsSync,
): string => {
  let candidateName = filename;
  let candidatePath = path.posix.join(basePath, candidateName);
  let counter = 1;

  while (existsSync(candidatePath)) {
    candidateName = appendSuffix(filename, counter);
    candidatePath = path.posix.join(basePath, candidateName);
    counter += 1;
  }

  return candidatePath;
};
