import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(__dirname, "..", "..", relativePath), "utf8");

suite("TreeView dependency removal", () => {
  test("command registry no longer imports old TreeView files", () => {
    const source = readSource("src/app/commandRegistry.ts");
    assert.ok(!source.includes("../views/ticketsView"));
    assert.ok(!source.includes("../views/commentsView"));
    assert.ok(!source.includes("../views/projectsView"));
    assert.ok(!source.includes("../views/unsyncedFilesView"));
    assert.ok(!source.includes("../views/ticketSettingsView"));
  });

  test("extension does not use never cast for registerCommands", () => {
    const source = readSource("src/extension.ts");
    assert.ok(!source.includes("as never"));
  });
});
