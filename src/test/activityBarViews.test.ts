import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const loadPackageJson = (): Record<string, unknown> => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
};

suite("Activity Bar view container", () => {
  test("declares Activity Bar container metadata", () => {
    const packageJson = loadPackageJson();
    const contributes = packageJson.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "contributes must be defined");

    const viewsContainers = contributes.viewsContainers as
      | Record<string, Array<{ id: string; title: string; icon?: string }>>
      | undefined;
    assert.ok(viewsContainers?.activitybar, "viewsContainers.activitybar must be defined");

    const container = viewsContainers.activitybar.find(
      (entry) => entry.id === "todoexActivity",
    );
    assert.ok(container, "todoexActivity container must exist");
    assert.strictEqual(container?.title, "TodoEx");
    assert.ok(container?.icon, "todoexActivity container icon must be defined");
  });

  test("activates on Activity Bar views", () => {
    const packageJson = loadPackageJson();
    const activationEvents = packageJson.activationEvents as string[] | undefined;
    assert.ok(activationEvents, "activationEvents must be defined");

    assert.ok(
      activationEvents.includes("onView:todoexActivityProjects"),
      "onView:todoexActivityProjects activation missing",
    );
    assert.ok(
      activationEvents.includes("onView:todoexActivityTickets"),
      "onView:todoexActivityTickets activation missing",
    );
    assert.ok(
      activationEvents.includes("onView:todoexActivityComments"),
      "onView:todoexActivityComments activation missing",
    );
  });
});
