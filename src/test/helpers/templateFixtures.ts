import * as path from "path";

type TemplateFixtureFs = {
  templatesDir: string;
  existsSync: (targetPath: string) => boolean;
  readFileSync: (targetPath: string) => string;
  readdirSync: (targetPath: string) => string[];
};

export const createTemplateFixture = (
  templatesDir: string,
  files: Record<string, string>,
): TemplateFixtureFs => {
  const pathToName = new Map<string, string>();
  for (const name of Object.keys(files)) {
    pathToName.set(path.join(templatesDir, name), name);
  }

  return {
    templatesDir,
    existsSync: (targetPath: string) =>
      targetPath === templatesDir || pathToName.has(targetPath),
    readFileSync: (targetPath: string) => {
      const name = pathToName.get(targetPath);
      if (!name) {
        throw new Error(`Missing template fixture: ${targetPath}`);
      }
      const content = files[name];
      if (content === undefined) {
        throw new Error(`Missing template fixture: ${targetPath}`);
      }
      return content;
    },
    readdirSync: (targetPath: string) =>
      targetPath === templatesDir ? Object.keys(files) : [],
  };
};
