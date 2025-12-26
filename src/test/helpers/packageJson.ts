import * as fs from "fs";
import * as path from "path";

type PackageJson = Record<string, unknown>;

export const loadPackageJson = (): PackageJson => {
  const packageJsonPath = path.resolve(__dirname, "../../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJson;
};
