const { readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

function collectTestFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const testRoot = resolve(process.cwd(), ".tmp/technical-module-v2-test/tests");
const testFiles = collectTestFiles(testRoot);

if (testFiles.length === 0) {
  console.error(`No compiled technical-module-v2 tests found under ${testRoot}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-test-coverage", ...testFiles],
  {
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
