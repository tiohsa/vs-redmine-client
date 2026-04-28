import * as assert from "assert";

const ALLOWED_OPEN_SCHEMES = ["file", "vscode-userdata"];

const validateDocumentUri = (documentUri: string): { allowed: boolean; reason?: string } => {
  try {
    const url = new URL(documentUri);
    const scheme = url.protocol.replace(/:$/, "");
    if (!ALLOWED_OPEN_SCHEMES.includes(scheme)) {
      return { allowed: false, reason: `scheme "${scheme}" is not allowed` };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "invalid URI" };
  }
};

suite("dashboardUriValidation — URI scheme 検証", () => {
  test("file:// は許可される", () => {
    const result = validateDocumentUri("file:///home/user/project/ticket-123.md");
    assert.strictEqual(result.allowed, true);
  });

  test("vscode-userdata:// は許可される", () => {
    const result = validateDocumentUri("vscode-userdata:/path/to/file.md");
    assert.strictEqual(result.allowed, true);
  });

  test("http:// は拒否される", () => {
    const result = validateDocumentUri("http://evil.example.com/script");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("http"));
  });

  test("https:// は拒否される", () => {
    const result = validateDocumentUri("https://evil.example.com/");
    assert.strictEqual(result.allowed, false);
  });

  test("javascript: は拒否される", () => {
    const result = validateDocumentUri("javascript:alert(1)");
    assert.strictEqual(result.allowed, false);
  });

  test("data: は拒否される", () => {
    const result = validateDocumentUri("data:text/html,<script>alert(1)</script>");
    assert.strictEqual(result.allowed, false);
  });

  test("空文字は拒否される", () => {
    const result = validateDocumentUri("");
    assert.strictEqual(result.allowed, false);
  });

  test("不正な URI は拒否される", () => {
    const result = validateDocumentUri("not a uri at all");
    assert.strictEqual(result.allowed, false);
  });

  test("許可スキームのリストは file と vscode-userdata の2種類", () => {
    assert.deepStrictEqual(ALLOWED_OPEN_SCHEMES, ["file", "vscode-userdata"]);
  });
});
