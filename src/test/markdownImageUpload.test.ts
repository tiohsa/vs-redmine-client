import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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

  test("falls back to images directory for plain filenames", async () => {
    const fallbackPath = path.resolve("/repo", "images", "image-25.png");
    const result = await processMarkdownImageUploads({
      content: "![img](image-25.png)",
      baseDir: "/repo",
      uploadFile: async () => ({
        token: "t1",
        filename: "image-25.png",
        contentType: "image/png",
      }),
      validatePath: async (filePath) => {
        if (filePath === fallbackPath) {
          return { valid: true };
        }
        return { valid: false, reason: "File not found." };
      },
    });

    assert.strictEqual(result.uploads.length, 1);
    assert.strictEqual(result.content, "![img](image-25.png)");
  });

  test("rejects absolute paths, traversal, and symlink escapes", async function () {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-image-base-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-image-outside-"));
    const outsideFile = path.join(outsideDir, "secret.png");
    fs.writeFileSync(outsideFile, "secret");

    const symlinkDir = path.join(baseDir, "linked");
    try {
      fs.symlinkSync(outsideDir, symlinkDir, "junction");
    } catch {
      this.skip();
      return;
    }

    for (const value of [
      "../secret.png",
      "../../secret.png",
      "/home/user/secret.png",
      "C:\\Users\\user\\secret.png",
      "./linked/secret.png",
    ]) {
      let uploadCalls = 0;
      const result = await processMarkdownImageUploads({
        content: `![secret](${value})`,
        baseDir,
        uploadFile: async () => {
          uploadCalls++;
          return { token: "unexpected", filename: "secret.png", contentType: "image/png" };
        },
        validatePath: async () => ({ valid: true }),
      });

      assert.strictEqual(uploadCalls, 0, `upload must be rejected for ${value}`);
      assert.strictEqual(result.uploads.length, 0, `no token must be produced for ${value}`);
    }
  });
});
