import * as assert from "assert";
import { convertMermaidBlocks } from "../utils/mermaid";

suite("Mermaid conversion", () => {
  test("converts mermaid code blocks", () => {
    const input = "Before\n```mermaid\nA-->B\n```\nAfter";
    const output = convertMermaidBlocks(input);

    assert.ok(output.includes("{{mermaid"));
    assert.ok(output.includes("A-->B"));
    assert.ok(output.includes("}}"));
  });
});
