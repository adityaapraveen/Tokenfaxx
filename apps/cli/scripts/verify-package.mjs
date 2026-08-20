import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(cliDirectory, "dist");
const packageFile = path.join(outputDirectory, "package.json");

if (!fs.existsSync(packageFile)) {
  throw new Error("Release package is missing; run the CLI build first");
}

const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
const dependencies = Object.values(manifest.dependencies ?? {});
if (dependencies.some((value) => String(value).startsWith("workspace:"))) {
  throw new Error("Release package contains workspace dependencies");
}
if (manifest.private) throw new Error("Release package must not be private");
if (manifest.license !== "MIT") throw new Error("Release package must be MIT");

for (const file of [
  "index.js",
  "config-api.js",
  "README.md",
  "LICENSE",
  "docs/PRIVACY.md",
  "examples/benchmark.json",
]) {
  if (!fs.existsSync(path.join(outputDirectory, file))) {
    throw new Error(`Release package is missing ${file}`);
  }
}

const executable = fs.readFileSync(
  path.join(outputDirectory, "index.js"),
  "utf8",
);
if (!executable.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("Release CLI is missing its Node shebang");
}
if (executable.startsWith("#!/usr/bin/env node\n#!/usr/bin/env node")) {
  throw new Error("Release CLI contains duplicate shebangs");
}

process.stdout.write(
  `Verified ${manifest.name}@${manifest.version} release package\n`,
);
