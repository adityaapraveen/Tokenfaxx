import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
if (manifest.publishConfig?.access !== "public") {
  throw new Error("Release package must publish with public access");
}
if (manifest.exports?.["./config"] !== "./config-api.js") {
  throw new Error("Release package must export tokenfaxx/config");
}

for (const file of [
  "index.js",
  "config-api.js",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
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

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tokenfaxx-package-"));
const npmCache = path.join(temporary, "npm-cache");
const commandEnvironment = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_cache: npmCache,
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: commandEnvironment,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status ?? "not started"})\n${result.error?.message ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
};
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packOutput = JSON.parse(
    run(npmCommand, [
      "pack",
      outputDirectory,
      "--json",
      "--pack-destination",
      temporary,
    ]),
  );
  const packed = packOutput[0];
  if (!packed?.filename) throw new Error("npm pack did not report a tarball");
  const packedFiles = (packed.files ?? []).map((item) => item.path);
  if (packedFiles.some((file) => file.includes(".tokenfaxx"))) {
    throw new Error("Release tarball contains local TokenFaxx data");
  }
  const tarball = path.join(temporary, packed.filename);
  const installDirectory = path.join(temporary, "install");
  fs.mkdirSync(installDirectory);
  fs.writeFileSync(
    path.join(installDirectory, "package.json"),
    '{"name":"tokenfaxx-install-smoke","private":true}\n',
  );
  run(npmCommand, ["install", tarball, "--ignore-scripts=false"], {
    cwd: installDirectory,
  });
  const installedCli = path.join(
    installDirectory,
    "node_modules",
    "tokenfaxx",
    "index.js",
  );
  const runInstalledCli = (args, cwd) =>
    run(process.execPath, [installedCli, ...args], { cwd });
  const installedVersion = runInstalledCli(["--version"], installDirectory);
  if (installedVersion !== manifest.version) {
    throw new Error(
      `Installed CLI reported ${installedVersion}; expected ${manifest.version}`,
    );
  }

  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  run("git", ["init"], { cwd: target });
  runInstalledCli(["init"], target);
  const generatedConfig = fs.readFileSync(
    path.join(target, "tokenfaxx.config.ts"),
    "utf8",
  );
  if (generatedConfig.includes("@tokenfaxx/core")) {
    throw new Error(
      "Generated config depends on an unpublished workspace package",
    );
  }
  runInstalledCli(["doctor"], target);

  process.stdout.write(
    `Verified packed and clean-installed ${manifest.name}@${manifest.version} (${packedFiles.length} files)\n`,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
