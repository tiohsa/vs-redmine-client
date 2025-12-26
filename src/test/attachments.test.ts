import * as assert from "assert";
import { parseClipboardImageDataUri } from "../redmine/attachments";

suite("Attachment helpers", () => {
  test("parses clipboard image data URI", () => {
    const payload = "data:image/png;base64,aGVsbG8=";
    const result = parseClipboardImageDataUri(payload);

    assert.strictEqual(result.contentType, "image/png");
    assert.strictEqual(result.filename, "clipboard-image.png");
    assert.ok(result.buffer.length > 0);
  });
});
