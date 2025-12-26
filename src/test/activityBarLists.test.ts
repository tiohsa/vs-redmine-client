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
  test("declares projects/tickets/comments views under the Activity Bar container", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const views = contributes.views as Record<string, ViewContribution[]> | undefined;
    assert.ok(views?.todoexActivity, "views.todoexActivity must be defined");

    const viewIds = views.todoexActivity.map((view) => view.id);
    assert.ok(viewIds.includes("todoexActivityProjects"));
    assert.ok(viewIds.includes("todoexActivityTickets"));
    assert.ok(viewIds.includes("todoexActivityComments"));
  });
});
