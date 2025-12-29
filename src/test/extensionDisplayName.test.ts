import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type CommandContribution = { title?: string };
type ViewsContainerContribution = { id: string; title: string };

type PackageJson = {
  displayName?: string;
  contributes?: {
    commands?: CommandContribution[];
    viewsContainers?: { activitybar?: ViewsContainerContribution[] };
    configuration?: { title?: string };
  };
};

const loadPackageJson = (): PackageJson => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJson;
};

const loadReadme = (filename: string): string => {
  const readmePath = path.resolve(__dirname, `../../${filename}`);
  return fs.readFileSync(readmePath, "utf8");
};

suite("Extension display name", () => {
  test("uses Redmine Client as display name", () => {
    const packageJson = loadPackageJson();
    assert.strictEqual(packageJson.displayName, "Redmine Client");
  });

  test("uses Redmine Client in Activity Bar container", () => {
    const packageJson = loadPackageJson();
    const containers = packageJson.contributes?.viewsContainers?.activitybar ?? [];
    const container = containers.find((entry) => entry.id === "todoexActivity");
    assert.ok(container, "todoexActivity container must exist");
    assert.strictEqual(container?.title, "Redmine Client");
  });

  test("uses Redmine Client for configuration title", () => {
    const packageJson = loadPackageJson();
    assert.strictEqual(packageJson.contributes?.configuration?.title, "Redmine Client");
  });

  test("does not expose TodoEx in command titles", () => {
    const packageJson = loadPackageJson();
    const titles = (packageJson.contributes?.commands ?? [])
      .map((command) => command.title ?? "")
      .filter((title) => title.length > 0);

    assert.ok(titles.length > 0, "command titles must exist");
    assert.ok(titles.every((title) => !title.includes("TodoEx")));
  });

  test("uses Redmine Client in README files", () => {
    const readme = loadReadme("README.md");
    const readmeJa = loadReadme("README.ja.md");

    assert.ok(readme.includes("Redmine Client"));
    assert.ok(readmeJa.includes("Redmine Client"));
    assert.ok(!readme.includes("TodoEx"));
    assert.ok(!readmeJa.includes("TodoEx"));
  });
});
