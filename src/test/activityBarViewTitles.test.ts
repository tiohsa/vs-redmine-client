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

const loadNls = (): Record<string, string> => {
  const nlsPath = path.resolve(__dirname, "../../package.nls.json");
  const raw = fs.readFileSync(nlsPath, "utf8");
  return JSON.parse(raw) as Record<string, string>;
};

const resolveNls = (value: string, nls: Record<string, string>): string => {
  const match = /^%(.+)%$/.exec(value);
  if (match) {
    return nls[match[1]] ?? value;
  }
  return value;
};

suite("Activity Bar view titles", () => {
  test("Dashboard view has correct title", () => {
    const packageJson = loadPackageJson();
    const nls = loadNls();
    const views = packageJson.contributes?.views?.["redmine-clientActivity"] ?? [];
    const dashboard = views.find((v) => v.id === "redmine-clientActivityDashboard");
    assert.ok(dashboard, "Dashboard view must exist");
    assert.strictEqual(resolveNls(dashboard?.name ?? "", nls), "Dashboard");
  });

  test("does not use legacy Redmine view titles", () => {
    const packageJson = loadPackageJson();
    const nls = loadNls();
    const views = packageJson.contributes?.views?.["redmine-clientActivity"] ?? [];
    const names = views.map((view) => resolveNls(view.name, nls));

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
