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
    assert.strictEqual(container?.title, "Redmine Client");
    assert.ok(container?.icon, "todoexActivity container icon must be defined");
  });

  test("activates on Activity Bar views", () => {
    const packageJson = loadPackageJson();
    const activationEvents = packageJson.activationEvents as string[] | undefined;
    assert.ok(activationEvents, "activationEvents must be defined");

    assert.ok(
      activationEvents.includes("onView:todoexActivityTicketSettings"),
      "onView:todoexActivityTicketSettings activation missing",
    );
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

  test("uses the updated Activity Bar SVG icon", () => {
    const svgPath = path.resolve(__dirname, "../../media/todoex-activitybar.svg");
    const raw = fs.readFileSync(svgPath, "utf8");

    assert.ok(raw.includes('viewBox="2 2 20 20"'), "SVG viewBox must match");
    assert.ok(raw.includes('fill="currentColor"'), "SVG fill must use currentColor");
    assert.ok(
      raw.includes(
        'd="M4 18h3.5v-5c0-2.48 2.02-4.5 4.5-4.5s4.5 2.02 4.5 4.5v5H20v-3.5c0-4.42-3.58-8-8-8s-8 3.58-8 8V18zM10 18h4v-5c0-1.1-.9-2-2-2s-2 .9-2 2v5z"',
      ),
      "SVG path data must match the provided icon",
    );
  });
});
