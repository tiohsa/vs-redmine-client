import * as assert from "assert";
import {
  applyMarkdownImageReplacements,
  extractMarkdownImageLinks,
} from "../utils/markdownImageLinks";
import { MARKDOWN_IMAGE_FIXTURES } from "./helpers/markdownImageFixtures";

suite("Markdown image links", () => {
  test("extracts local image links with ranges", () => {
    const links = extractMarkdownImageLinks(MARKDOWN_IMAGE_FIXTURES.singleLocal);

    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].path, "./images/sample.png");
    assert.strictEqual(
      MARKDOWN_IMAGE_FIXTURES.singleLocal.slice(
        links[0].range.start,
        links[0].range.end,
      ),
      "./images/sample.png",
    );
  });

  test("replaces multiple image links", () => {
    const content = MARKDOWN_IMAGE_FIXTURES.multipleLocal;
    const links = extractMarkdownImageLinks(content);
    const replacements = links.map((link, index) => ({
      range: link.range,
      value: index === 0 ? "one.png" : "two.jpg",
    }));

    const result = applyMarkdownImageReplacements(content, replacements);

    assert.ok(result.includes("![one](one.png)"));
    assert.ok(result.includes("![two](two.jpg)"));
  });
});
