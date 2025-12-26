import * as assert from "assert";
import { buildUniqueUntitledPath } from "../views/untitledPath";

suite("Untitled path builder", () => {
  test("returns base path when filename is available", () => {
    const exists = new Set<string>();
    const result = buildUniqueUntitledPath(
      "/workspace",
      "project-1_ticket-76.md",
      (candidate) => exists.has(candidate),
    );

    assert.strictEqual(result, "/workspace/project-1_ticket-76.md");
  });

  test("increments suffix until a free path is found", () => {
    const exists = new Set<string>([
      "/workspace/project-1_ticket-76.md",
      "/workspace/project-1_ticket-76-1.md",
    ]);
    const result = buildUniqueUntitledPath(
      "/workspace",
      "project-1_ticket-76.md",
      (candidate) => exists.has(candidate),
    );

    assert.strictEqual(result, "/workspace/project-1_ticket-76-2.md");
  });

  test("appends suffix when filename has no extension", () => {
    const exists = new Set<string>(["/workspace/ticket"]);
    const result = buildUniqueUntitledPath(
      "/workspace",
      "ticket",
      (candidate) => exists.has(candidate),
    );

    assert.strictEqual(result, "/workspace/ticket-1");
  });
});
