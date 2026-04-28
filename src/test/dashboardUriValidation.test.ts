import * as assert from "assert";
import * as vscode from "vscode";

suite("dashboardUriValidation — URI scheme 検証", () => {
  const ALLOWED_SCHEMES = ["file", "vscode-userdata"];

  function isUriAllowed(uriStr: string): boolean {
    const uri = vscode.Uri.parse(uriStr);
    return ALLOWED_SCHEMES.includes(uri.scheme);
  }

  test("file:// スキームは許可される", () => {
    assert.strictEqual(isUriAllowed("file:///home/user/project/ticket.md"), true);
  });

  test("vscode-userdata:// スキームは許可される", () => {
    assert.strictEqual(isUriAllowed("vscode-userdata:///user/settings.json"), true);
  });

  test("http:// スキームは拒否される", () => {
    assert.strictEqual(isUriAllowed("http://example.com/evil"), false);
  });

  test("https:// スキームは拒否される", () => {
    assert.strictEqual(isUriAllowed("https://malicious.site/payload"), false);
  });

  test("javascript: スキームは拒否される", () => {
    assert.strictEqual(isUriAllowed("javascript:alert(1)"), false);
  });

  test("data: スキームは拒否される", () => {
    assert.strictEqual(isUriAllowed("data:text/html,<script>alert(1)</script>"), false);
  });

  test("untitled:// スキームは拒否される", () => {
    assert.strictEqual(isUriAllowed("untitled:Untitled-1"), false);
  });

  test("vscode.Uri.parse で file URI のスキームが file になる", () => {
    const uri = vscode.Uri.parse("file:///path/to/file.md");
    assert.strictEqual(uri.scheme, "file");
  });

  test("vscode.Uri.parse で http URI のスキームが http になる", () => {
    const uri = vscode.Uri.parse("http://example.com");
    assert.strictEqual(uri.scheme, "http");
  });

  test("許可スキームリストに file と vscode-userdata が含まれる", () => {
    assert.ok(ALLOWED_SCHEMES.includes("file"));
    assert.ok(ALLOWED_SCHEMES.includes("vscode-userdata"));
    assert.ok(!ALLOWED_SCHEMES.includes("http"));
    assert.ok(!ALLOWED_SCHEMES.includes("javascript"));
  });
});
