import * as assert from "assert";
import { processMarkdownImageUploads } from "../utils/markdownImageUpload";
import { MARKDOWN_IMAGE_FIXTURES } from "./helpers/markdownImageFixtures";

suite("Markdown image upload", () => {
  test("uploads unique paths once and replaces links", async () => {
    const result = await processMarkdownImageUploads({
      content: "![one](./img.png) and ![two](./img.png)",
      baseDir: "/repo",
      uploadFile: async () => ({
        token: "t1",
        filename: "img.png",
        contentType: "image/png",
      }),
      validatePath: async () => ({ valid: true }),
    });

    assert.strictEqual(result.uploads.length, 1);
    assert.ok(result.content.includes("![one](img.png)"));
    assert.ok(result.content.includes("![two](img.png)"));
  });

  test("skips external links", async () => {
    const result = await processMarkdownImageUploads({
      content: MARKDOWN_IMAGE_FIXTURES.external,
      baseDir: "/repo",
      uploadFile: async () => ({
        token: "t1",
        filename: "img.png",
        contentType: "image/png",
      }),
      validatePath: async () => ({ valid: true }),
    });

    assert.strictEqual(result.uploads.length, 0);
    assert.strictEqual(result.content, MARKDOWN_IMAGE_FIXTURES.external);
  });

  test("returns failures for invalid paths", async () => {
    const result = await processMarkdownImageUploads({
      content: "![bad](./bad.txt)",
      baseDir: "/repo",
      uploadFile: async () => ({
        token: "t1",
        filename: "bad.txt",
        contentType: "text/plain",
      }),
      validatePath: async () => ({ valid: false, reason: "Unsupported" }),
    });

    assert.strictEqual(result.summary.failures.length, 1);
    assert.strictEqual(result.summary.permissionDenied, false);
  });

  test("marks permission denied when upload forbidden", async () => {
    const result = await processMarkdownImageUploads({
      content: MARKDOWN_IMAGE_FIXTURES.singleLocal,
      baseDir: "/repo",
      uploadFile: async () => {
        throw new Error("Request failed (403): Forbidden");
      },
      validatePath: async () => ({ valid: true }),
    });

    assert.strictEqual(result.summary.permissionDenied, true);
    assert.strictEqual(result.uploads.length, 0);
    assert.strictEqual(result.content, MARKDOWN_IMAGE_FIXTURES.singleLocal);
  });
});
