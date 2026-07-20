import * as assert from "assert";
import { buildCommentUrl, buildProjectUrl, buildTicketUrl } from "../utils/redmineUrls";
import { buildUrl } from "../redmine/client";

suite("Redmine URL builders", () => {
  test("builds project URL from identifier", () => {
    const result = buildProjectUrl("https://example.com", "alpha");
    assert.strictEqual(result.url, "https://example.com/projects/alpha");
  });

  test("builds ticket URL from id", () => {
    const result = buildTicketUrl("https://example.com/", 42);
    assert.strictEqual(result.url, "https://example.com/issues/42");
  });

  test("preserves a Redmine subpath in browser URLs", () => {
    const result = buildTicketUrl("https://example.com/redmine", 42);
    assert.strictEqual(result.url, "https://example.com/redmine/issues/42");
  });

  test("preserves a Redmine subpath in API URLs", () => {
    const result = buildUrl("https://example.com/redmine", "/issues.json", { limit: 50 });
    assert.strictEqual(result, "https://example.com/redmine/issues.json?limit=50");
  });

  test("builds comment URL with anchor", () => {
    const result = buildCommentUrl("https://example.com", 10, 99);
    assert.strictEqual(result.url, "https://example.com/issues/10#note-99");
  });

  test("prefers note index when provided", () => {
    const result = buildCommentUrl("https://example.com", 10, 99, 3);
    assert.strictEqual(result.url, "https://example.com/issues/10#note-3");
  });

  test("returns error when base URL is missing", () => {
    const result = buildProjectUrl("", "alpha");
    assert.strictEqual(result.errorMessage, "Missing Redmine base URL configuration.");
  });

  test("returns error when identifier is missing", () => {
    const result = buildProjectUrl("https://example.com", "");
    assert.strictEqual(result.errorMessage, "Project identifier is missing.");
  });
});
