import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type ViewContribution = { id: string; name: string };

type PackageJson = {
  contributes?: {
    views?: Record<string, ViewContribution[]>;
  };
};

const loadPackageJson = (): PackageJson => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJson;
};

suite("Activity Bar view titles", () => {
  test("uses short titles for Activity Bar views", () => {
    const packageJson = loadPackageJson();
    const views = packageJson.contributes?.views?.todoexActivity ?? [];
    const viewById = (id: string): ViewContribution | undefined =>
      views.find((view) => view.id === id);

    assert.strictEqual(viewById("todoexActivityProjects")?.name, "Projects");
    assert.strictEqual(viewById("todoexActivityTickets")?.name, "Tickets");
    assert.strictEqual(viewById("todoexActivityComments")?.name, "Comments");
  });

  test("does not use legacy Redmine view titles", () => {
    const packageJson = loadPackageJson();
    const views = packageJson.contributes?.views?.todoexActivity ?? [];
    const names = views.map((view) => view.name);

    assert.ok(!names.includes("Redmine Projects"));
    assert.ok(!names.includes("Redmine Tickets"));
    assert.ok(!names.includes("Redmine Comments"));
  });
});
