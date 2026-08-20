import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(scriptDirectory, "..");
const repository = path.resolve(cliDirectory, "../..");
const outputDirectory = path.join(cliDirectory, "dist");
const sourcePackage = JSON.parse(
  fs.readFileSync(path.join(cliDirectory, "package.json"), "utf8"),
);

const runtimeDependencies = {
  "better-sqlite3": sourcePackage.dependencies["better-sqlite3"],
  commander: sourcePackage.dependencies.commander,
  "drizzle-orm": sourcePackage.dependencies["drizzle-orm"],
  jiti: sourcePackage.dependencies.jiti,
  pino: sourcePackage.dependencies.pino,
  "simple-git": sourcePackage.dependencies["simple-git"],
  zod: sourcePackage.dependencies.zod,
};

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external: Object.keys(runtimeDependencies),
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(cliDirectory, "src/index.ts")],
    outfile: path.join(outputDirectory, "index.js"),
  }),
  build({
    ...common,
    entryPoints: [path.join(cliDirectory, "src/config-api.ts")],
    outfile: path.join(outputDirectory, "config-api.js"),
  }),
]);

fs.chmodSync(path.join(outputDirectory, "index.js"), 0o755);

const publishPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  type: "module",
  bin: { tokenfaxx: "index.js" },
  engines: sourcePackage.engines,
  repository: {
    type: "git",
    url: "git+https://github.com/adityaapraveen/Tokenfaxx.git",
  },
  homepage: "https://github.com/adityaapraveen/Tokenfaxx#readme",
  bugs: { url: "https://github.com/adityaapraveen/Tokenfaxx/issues" },
  author: "adityaapraveen",
  keywords: [
    "ai",
    "coding-agent",
    "codex",
    "evaluation",
    "observability",
    "benchmark",
    "cli",
  ],
  dependencies: runtimeDependencies,
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org/",
  },
};

const license = path.join(repository, "LICENSE");
if (fs.existsSync(license)) {
  publishPackage.license = "MIT";
  fs.copyFileSync(license, path.join(outputDirectory, "LICENSE"));
}

fs.copyFileSync(
  path.join(repository, "README.md"),
  path.join(outputDirectory, "README.md"),
);
fs.cpSync(path.join(repository, "docs"), path.join(outputDirectory, "docs"), {
  recursive: true,
});
fs.mkdirSync(path.join(outputDirectory, "examples"), { recursive: true });
fs.copyFileSync(
  path.join(repository, "examples/benchmark.json"),
  path.join(outputDirectory, "examples/benchmark.json"),
);
fs.writeFileSync(
  path.join(outputDirectory, "package.json"),
  `${JSON.stringify(publishPackage, null, 2)}\n`,
);
