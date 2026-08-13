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
});
