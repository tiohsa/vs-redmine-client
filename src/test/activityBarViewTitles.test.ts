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
  test("Dashboard view has correct title", () => {
    const packageJson = loadPackageJson();
    const views = packageJson.contributes?.views?.["redmine-clientActivity"] ?? [];
    const dashboard = views.find((v) => v.id === "redmine-clientActivityDashboard");
    assert.ok(dashboard, "Dashboard view must exist");
    assert.strictEqual(dashboard?.name, "Dashboard");
  });

  test("does not use legacy Redmine view titles", () => {
    const packageJson = loadPackageJson();
    const views = packageJson.contributes?.views?.["redmine-clientActivity"] ?? [];
    const names = views.map((view) => view.name);

    assert.ok(!names.includes("Redmine Projects"));
    assert.ok(!names.includes("Redmine Tickets"));
    assert.ok(!names.includes("Redmine Comments"));
    // レガシービューは削除済み
    assert.ok(!names.includes("Local Changes"));
    assert.ok(!names.includes("Projects"));
    assert.ok(!names.includes("Tickets"));
    assert.ok(!names.includes("Comments"));
    assert.ok(!names.includes("Ticket Settings"));
  });
});
