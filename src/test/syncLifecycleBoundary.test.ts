import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const source = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

suite("Sync lifecycle module boundary", () => {
  test("I-19 public ticketSaveSync facade は remote mutation adapter を公開しない", () => {
    const facade = source("src/views/ticketSaveSync.ts");
    for (const forbidden of [
      "export const syncTicketDraft",
      "export const syncNewTicketDraft",
      "export const syncNewTicketDraftContent",
      "export const createTicketFromQueuedContent",
      "export const applyQueuedTicketUpdate",
    ]) {
      assert.ok(!facade.includes(forbidden), forbidden);
    }
  });

  test("comment command adapters は queueAndSyncComment 経由でremote mutationする", () => {
    for (const file of [
      "src/commands/addComment.ts",
      "src/commands/editComment.ts",
      "src/commands/commentPrompt.ts",
    ]) {
      const command = source(file);
      assert.ok(command.includes("queueAndSyncComment"), file);
      assert.ok(!command.includes("deps.addComment("), file);
      assert.ok(!command.includes("deps.updateComment("), file);
    }
  });

  test("RT-01: non-test source files in src/ do not import from src/test", () => {
    const srcDir = path.join(process.cwd(), "src");
    const scanDir = (dir: string): string[] => {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") {
            results.push(...scanDir(fullPath));
          }
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          results.push(fullPath);
        }
      }
      return results;
    };

    const files = scanDir(srcDir);
    const violations: Array<{ file: string; match: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const relative = path.relative(process.cwd(), file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          (line.includes("from \"../test/") ||
            line.includes("from './test/") ||
            line.includes("from '@/test/") ||
            line.includes("from '../test'") ||
            line.includes("from \"./test\"") ||
            line.includes("require(\"../test/") ||
            line.includes("require('../test/")) &&
          !line.trim().startsWith("//")
        ) {
          violations.push({ file: `${relative}:${i + 1}`, match: line.trim() });
        }
      }
    }

    assert.strictEqual(
      violations.length,
      0,
      `Production source files must not import from test helpers:\n${violations.map((v) => `  ${v.file}: ${v.match}`).join("\n")}`,
    );
  });
});

