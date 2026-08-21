import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { simpleGit } from "simple-git";

export interface GitFileState {
  path: string;
  index: string;
  workingTree: string;
}
export interface GitSnapshot {
  branch: string | null;
  headSha: string | null;
  changedFileCount: number;
  linesAdded: number;
  linesDeleted: number;
  uncommittedChanges: boolean;
  files: GitFileState[];
}
export interface GitSample {
  sequence: number;
  headSha: string | null;
  changedFiles: {
    path: string;
    index: string;
    workingTree: string;
    size: number | null;
    modifiedAtMs: number | null;
  }[];
}
export interface GitDelta {
  commits: string[];
  files: {
    path: string;
    changeType: "created" | "modified" | "deleted" | "renamed";
  }[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  filesCreated: number;
  filesDeleted: number;
  remainsUncommitted: boolean;
}

export class GitCollector {
  constructor(private readonly repository: string) {}
  async isRepository(): Promise<boolean> {
    return simpleGit(this.repository).checkIsRepo();
  }
  async repositoryInfo(): Promise<{
    root: string;
    name: string;
    remote: string | null;
  }> {
    const git = simpleGit(this.repository);
    const root = await git
      .revparse(["--show-toplevel"])
      .catch(() => this.repository);
    const remotes = await git.getRemotes(true).catch(() => []);
    return {
      root: root.trim(),
      name: path.basename(root.trim()),
      remote:
        remotes.find((item) => item.name === "origin")?.refs.fetch ??
        remotes[0]?.refs.fetch ??
        null,
    };
  }
  async snapshot(): Promise<GitSnapshot> {
    const git = simpleGit(this.repository);
    if (!(await git.checkIsRepo()))
      return {
        branch: null,
        headSha: null,
        changedFileCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
        uncommittedChanges: false,
        files: [],
      };
    const [branch, status, head, diff] = await Promise.all([
      git.branchLocal(),
      git.status(),
      git.revparse(["HEAD"]).catch(() => ""),
      git.diffSummary().catch(() => ({ insertions: 0, deletions: 0 })),
    ]);
    return {
      branch: branch.current || null,
      headSha: head.trim() || null,
      changedFileCount: status.files.length,
      linesAdded: diff.insertions,
      linesDeleted: diff.deletions,
      uncommittedChanges: !status.isClean(),
      files: status.files.map((f) => ({
        path: f.path,
        index: f.index,
        workingTree: f.working_dir,
      })),
    };
  }
  async sample(sequence: number): Promise<GitSample> {
    const git = simpleGit(this.repository);
    if (!(await git.checkIsRepo()))
      return { sequence, headSha: null, changedFiles: [] };
    const [status, head] = await Promise.all([
      git.status(),
      git.revparse(["HEAD"]).catch(() => ""),
    ]);
    return {
      sequence,
      headSha: head.trim() || null,
      changedFiles: status.files
        .map((item) => ({
          path: item.path,
          index: item.index,
          workingTree: item.working_dir,
        }))
        .map((file) => {
          try {
            const stat = fs.statSync(path.join(this.repository, file.path));
            return {
              ...file,
              size: stat.isFile() ? stat.size : null,
              modifiedAtMs: Math.round(stat.mtimeMs),
            };
          } catch {
            return { ...file, size: null, modifiedAtMs: null };
          }
        }),
    };
  }
  async compare(before: GitSnapshot, after: GitSnapshot): Promise<GitDelta> {
    const git = simpleGit(this.repository);
    let commits: string[] = [];
    let summary: {
      files: { file: string }[];
      insertions: number;
      deletions: number;
    } = {
      files: [],
      insertions: 0,
      deletions: 0,
    };
    if (before.headSha && after.headSha && before.headSha !== after.headSha) {
      commits = (
        await git.log({ from: before.headSha, to: after.headSha })
      ).all.map((c) => c.hash);
      summary = await git.diffSummary([before.headSha, after.headSha]);
    }
    const beforeFiles = new Map(
      before.files.map((file) => [
        file.path,
        `${file.index}:${file.workingTree}`,
      ]),
    );
    const afterFiles = new Map(
      after.files.map((file) => [
        file.path,
        `${file.index}:${file.workingTree}`,
      ]),
    );
    const changedPaths = new Set(summary.files.map((file) => file.file));
    for (const path of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
      if (beforeFiles.get(path) !== afterFiles.get(path))
        changedPaths.add(path);
    }
    const newlyObserved = after.files.filter(
      (file) => !beforeFiles.has(file.path),
    );
    const files = [...changedPaths].map((path) => {
      const state = after.files.find((file) => file.path === path);
      const code = `${state?.index ?? ""}${state?.workingTree ?? ""}`;
      const changeType = code.includes("A")
        ? "created"
        : code.includes("D") || (!state && beforeFiles.has(path))
          ? "deleted"
          : code.includes("R")
            ? "renamed"
            : "modified";
      return { path, changeType } as const;
    });
    return {
      commits,
      files,
      filesChanged: changedPaths.size,
      linesAdded:
        summary.insertions || Math.max(0, after.linesAdded - before.linesAdded),
      linesDeleted:
        summary.deletions ||
        Math.max(0, after.linesDeleted - before.linesDeleted),
      filesCreated: newlyObserved.filter(
        (f) => f.index === "A" || f.workingTree === "A",
      ).length,
      filesDeleted: newlyObserved.filter(
        (f) => f.index === "D" || f.workingTree === "D",
      ).length,
      remainsUncommitted: after.uncommittedChanges,
    };
  }
}

export class GitTimelineCollector {
  private timer: NodeJS.Timeout | undefined;
  private sequence = 0;
  private running = false;
  constructor(
    private readonly collector: GitCollector,
    private readonly intervalMs: number,
    private readonly onSample: (sample: GitSample) => void | Promise<void>,
  ) {}
  start(): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      if (this.running) return;
      this.running = true;
      try {
        await this.onSample(await this.collector.sample(this.sequence++));
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.intervalMs);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await this.onSample(await this.collector.sample(this.sequence++));
  }
}

export type ValidationType = "test" | "build" | "lint" | "typecheck";
export interface ValidationResult {
  type: ValidationType;
  command: string;
  status: "passed" | "failed" | "skipped" | "timed-out";
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  details: ValidationDetails;
}
export interface ValidationDetails {
  parser: string;
  testFilesPassed: number | null;
  testFilesFailed: number | null;
  testsPassed: number | null;
  testsFailed: number | null;
  testsSkipped: number | null;
  diagnostics: number | null;
  warnings: number | null;
  coveragePercent: number | null;
  source: "machine-readable" | "terminal-summary" | "exit-code";
  limitations: string[];
}
const emptyDetails = (parser = "none"): ValidationDetails => ({
  parser,
  testFilesPassed: null,
  testFilesFailed: null,
  testsPassed: null,
  testsFailed: null,
  testsSkipped: null,
  diagnostics: null,
  warnings: null,
  coveragePercent: null,
  source: "exit-code",
  limitations: ["Only the command exit code was available"],
});
export interface ValidationOptions {
  parser?:
    "auto" | "vitest" | "jest" | "junit" | "eslint" | "typescript" | "none";
  resultFile?: string;
  maxOutputBytes?: number;
}
function parseValidation(
  parser: ValidationOptions["parser"],
  output: string,
  resultFile: string | undefined,
  cwd: string,
  maxResultBytes: number,
): ValidationDetails {
  let content = output;
  let source: ValidationDetails["source"] = "terminal-summary";
  if (resultFile) {
    try {
      const repositoryRoot = fs.realpathSync(cwd);
      const resolvedResult = fs.realpathSync(path.resolve(repositoryRoot, resultFile));
      const relative = path.relative(repositoryRoot, resolvedResult);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error("path escapes the validation working directory");
      const stat = fs.statSync(resolvedResult);
      if (!stat.isFile()) throw new Error("path is not a regular file");
      if (stat.size > maxResultBytes)
        throw new Error(`file exceeds the ${maxResultBytes}-byte limit`);
      content = fs.readFileSync(resolvedResult, "utf8");
      source = "machine-readable";
    } catch (error) {
      return {
        ...emptyDetails(parser),
        limitations: [
          `Configured result file '${resultFile}' was not readable safely: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
  const selected =
    parser === "auto"
      ? content.trimStart().startsWith("{") ||
        content.trimStart().startsWith("[")
        ? "jest"
        : /Test Files/i.test(content)
          ? "vitest"
          : /TS\d{4}/.test(content)
            ? "typescript"
            : "none"
      : parser;
  try {
    if (selected === "jest" || selected === "vitest") {
      if (
        source === "machine-readable" ||
        content.trimStart().startsWith("{")
      ) {
        const json = JSON.parse(content) as Record<string, unknown>;
        return {
          ...emptyDetails(selected),
          parser: selected,
          testFilesPassed: Number(
            json.numPassedTestSuites ?? json.numPassedTestFiles ?? 0,
          ),
          testFilesFailed: Number(
            json.numFailedTestSuites ?? json.numFailedTestFiles ?? 0,
          ),
          testsPassed: Number(json.numPassedTests ?? 0),
          testsFailed: Number(json.numFailedTests ?? 0),
          testsSkipped: Number(json.numPendingTests ?? 0),
          source,
          limitations: [],
        };
      }
      const files = content.match(
        /Test Files\s+(?:(\d+) failed[^\n]*)?\s*(?:(\d+) passed)?/i,
      );
      const tests = content.match(
        /Tests\s+(?:(\d+) failed[^\n]*)?\s*(?:(\d+) passed)?(?:[^\n]*?(\d+) skipped)?/i,
      );
      return {
        ...emptyDetails(selected),
        parser: selected,
        testFilesPassed: files?.[2] ? Number(files[2]) : null,
        testFilesFailed: files?.[1] ? Number(files[1]) : 0,
        testsPassed: tests?.[2] ? Number(tests[2]) : null,
        testsFailed: tests?.[1] ? Number(tests[1]) : 0,
        testsSkipped: tests?.[3] ? Number(tests[3]) : 0,
        source,
        limitations: [
          "Parsed from human-readable output; configure resultFile for stronger evidence",
        ],
      };
    }
    if (selected === "junit") {
      const suites = [...content.matchAll(/<testsuite\b[^>]*>/g)];
      const attr = (name: string): number =>
        suites.reduce(
          (sum, match) =>
            sum +
            Number(match[0].match(new RegExp(`${name}="(\\d+)"`))?.[1] ?? 0),
          0,
        );
      return {
        ...emptyDetails("junit"),
        testsPassed: Math.max(
          0,
          attr("tests") - attr("failures") - attr("errors") - attr("skipped"),
        ),
        testsFailed: attr("failures") + attr("errors"),
        testsSkipped: attr("skipped"),
        source: "machine-readable",
        limitations: [],
      };
    }
    if (selected === "eslint") {
      const rows = JSON.parse(content) as {
        errorCount?: number;
        warningCount?: number;
      }[];
      return {
        ...emptyDetails("eslint"),
        diagnostics: rows.reduce((sum, row) => sum + (row.errorCount ?? 0), 0),
        warnings: rows.reduce((sum, row) => sum + (row.warningCount ?? 0), 0),
        source,
        limitations: [],
      };
    }
    if (selected === "typescript")
      return {
        ...emptyDetails("typescript"),
        diagnostics: (content.match(/error TS\d{4}/g) ?? []).length,
        source,
        limitations:
          source === "machine-readable"
            ? []
            : ["Diagnostics were counted from compiler output"],
      };
  } catch (error) {
    return {
      ...emptyDetails(String(selected)),
      limitations: [
        `Parser failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  return emptyDetails(String(selected ?? "none"));
}
function safeValidationEnv(): NodeJS.ProcessEnv {
  const blocked = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH)/i;
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      name === "PATH" || name === "HOME" || name === "USER" || name === "SHELL" || !blocked.test(name),
    ),
  );
}

export async function runValidation(
  type: ValidationType,
  command: string,
  timeoutMs: number,
  cwd: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: safeValidationEnv(),
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    let output = "";
    const limit = options.maxOutputBytes ?? 500_000;
    const capture = (chunk: Buffer, destination: NodeJS.WriteStream): void => {
      destination.write(chunk);
      if (output.length < limit)
        output += chunk.toString("utf8").slice(0, limit - output.length);
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, process.stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      const kill = (signal: NodeJS.Signals): void => {
        try {
          if (process.platform !== "win32") process.kill(-child.pid!, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({
        type,
        command,
        status: "failed",
        exitCode: null,
        durationMs: Date.now() - started,
        startedAt,
        completedAt: new Date().toISOString(),
        details: emptyDetails(options.parser),
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        type,
        command,
        status: timedOut ? "timed-out" : code === 0 ? "passed" : "failed",
        exitCode: code,
        durationMs: Date.now() - started,
        startedAt,
        completedAt: new Date().toISOString(),
        details: parseValidation(
          options.parser ?? "auto",
          output,
          options.resultFile,
          cwd,
          limit,
        ),
      });
    });
  });
}
