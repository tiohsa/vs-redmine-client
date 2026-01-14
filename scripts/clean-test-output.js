const fs = require("fs");
const path = require("path");

const outTestPath = path.join(__dirname, "..", "out", "test");

try {
  fs.rmSync(outTestPath, { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to clean test output: ${message}`);
}
