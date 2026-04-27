import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const loadPackageJson = (): Record<string, unknown> => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
};

type ViewContribution = { id: string; name: string };

suite("Activity Bar views", () => {
  test("declares only Dashboard view under the Activity Bar container", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const views = contributes.views as Record<string, ViewContribution[]> | undefined;
    assert.ok(
      views?.["redmine-clientActivity"],
      "views.redmine-clientActivity must be defined",
    );

    const viewIds = views["redmine-clientActivity"].map((view) => view.id);
    assert.ok(viewIds.includes("redmine-clientActivityDashboard"), "Dashboard view must exist");

    // レガシー TreeView は削除済み
    assert.ok(!viewIds.includes("redmine-clientActivityTicketSettings"), "TicketSettings must be removed");
    assert.ok(!viewIds.includes("redmine-clientActivityProjects"), "Projects must be removed");
    assert.ok(!viewIds.includes("redmine-clientActivityTickets"), "Tickets must be removed");
    assert.ok(!viewIds.includes("redmine-clientActivityUnsyncedFiles"), "UnsyncedFiles must be removed");
    assert.ok(!viewIds.includes("redmine-clientActivityComments"), "Comments must be removed");

    assert.strictEqual(viewIds.length, 1, "Only Dashboard view should be registered");
  });

  test("does not contribute showLegacyViews configuration", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    const config = contributes?.configuration as Record<string, unknown> | undefined;
    const properties = config?.properties as Record<string, unknown> | undefined;
    assert.ok(
      !properties?.["redmine-client.showLegacyViews"],
      "showLegacyViews config must be removed",
    );
  });
});
