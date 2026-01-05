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

export const buildUniqueUntitledName = (
  filename: string,
  isTaken: (candidate: string) => boolean,
): string => {
  let candidateName = filename;
  let counter = 1;

  while (isTaken(candidateName)) {
    candidateName = appendSuffix(filename, counter);
    counter += 1;
  }

  return candidateName;
};

export const buildUniqueUntitledPath = (
  basePath: string,
  filename: string,
  existsSync: ExistsSync,
): string => {
  const candidateName = buildUniqueUntitledName(filename, (candidate) =>
    existsSync(path.posix.join(basePath, candidate)),
  );
  return path.posix.join(basePath, candidateName);
};
