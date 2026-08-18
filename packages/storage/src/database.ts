import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { SessionRecord, TokenFaxxEvent } from "@tokenfaxx/core";
import { parseEvent } from "@tokenfaxx/core";
import { createId, nowIso } from "@tokenfaxx/shared";
import * as schema from "./schema.js";

const migration = `
CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_path TEXT NOT NULL UNIQUE, repository_remote TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, agent TEXT NOT NULL, adapter_version TEXT NOT NULL, task_id TEXT, task_description TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, child_process_exit_code INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_project_started_idx ON sessions(project_id, started_at); CREATE INDEX IF NOT EXISTS sessions_agent_idx ON sessions(agent); CREATE INDEX IF NOT EXISTS sessions_task_idx ON sessions(task_id);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, schema_version INTEGER NOT NULL, event_type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL, metadata TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_session_time_idx ON events(session_id, timestamp); CREATE INDEX IF NOT EXISTS events_type_idx ON events(event_type);
CREATE TABLE IF NOT EXISTS model_usage (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, provider TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER, total_tokens INTEGER, estimated_cost_usd REAL, cost_measurement TEXT, cost_source TEXT, pricing_effective_date TEXT, measurement_type TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, tool TEXT NOT NULL, action_type TEXT NOT NULL, success INTEGER NOT NULL, duration_ms INTEGER NOT NULL, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS command_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, command_category TEXT NOT NULL, exit_code INTEGER, duration_ms INTEGER NOT NULL, status TEXT NOT NULL, retry_number INTEGER NOT NULL, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS validation_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, validation_type TEXT NOT NULL, command TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, duration_ms INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS validation_session_idx ON validation_runs(session_id);
CREATE TABLE IF NOT EXISTS git_snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, snapshot_type TEXT NOT NULL, branch TEXT, head_sha TEXT, changed_file_count INTEGER NOT NULL, lines_added INTEGER NOT NULL, lines_deleted INTEGER NOT NULL, uncommitted_changes INTEGER NOT NULL, status_json TEXT NOT NULL, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_outcomes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL, accepted INTEGER, reason TEXT, evidence TEXT NOT NULL, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS score_snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, final_score REAL, confidence REAL NOT NULL, components TEXT NOT NULL, insufficient_data INTEGER NOT NULL, explanation TEXT NOT NULL, calculated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, provider TEXT NOT NULL, model TEXT NOT NULL, generation_id TEXT, evidence_hash TEXT NOT NULL, schema_version INTEGER NOT NULL, analysis_json TEXT NOT NULL, usage_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS analysis_session_idx ON analysis_snapshots(session_id, created_at);
INSERT OR IGNORE INTO _migrations(version, applied_at) VALUES (1, datetime('now'));
`;

export interface CreateSessionInput {
  repository: string;
  projectName: string;
  repositoryRemote?: string | null;
  agent: string;
  adapterVersion: string;
  taskId?: string;
  taskDescription?: string;
}
export interface SessionBundle {
  session: SessionRecord;
  events: TokenFaxxEvent[];
  validations: (typeof schema.validationRuns.$inferSelect)[];
  gitSnapshots: (typeof schema.gitSnapshots.$inferSelect)[];
  usage: (typeof schema.modelUsage.$inferSelect)[];
  score: typeof schema.scoreSnapshots.$inferSelect | null;
  outcome: typeof schema.taskOutcomes.$inferSelect | null;
  analyses: (typeof schema.analysisSnapshots.$inferSelect)[];
}

export class TokenFaxxDatabase {
  readonly sqlite: Database.Database;
  readonly db;
  constructor(public readonly filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.sqlite = new Database(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(migration);
    this.ensureColumn(
      "validation_runs",
      "details_json",
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.ensureColumn(
      "score_snapshots",
      "details_json",
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.ensureColumn("model_usage", "cost_measurement", "TEXT");
    this.ensureColumn("model_usage", "cost_source", "TEXT");
    this.ensureColumn("model_usage", "pricing_effective_date", "TEXT");
    const migrationTimestamp = nowIso();
    this.sqlite
      .prepare(
        "INSERT OR IGNORE INTO _migrations(version, applied_at) VALUES (2, ?)",
      )
      .run(migrationTimestamp);
    this.sqlite
      .prepare(
        "INSERT OR IGNORE INTO _migrations(version, applied_at) VALUES (3, ?)",
      )
      .run(migrationTimestamp);
    try {
      fs.chmodSync(filename, 0o600);
    } catch {
      /* permission hardening is best-effort on non-POSIX filesystems */
    }
    this.db = drizzle(this.sqlite, { schema });
  }
  close(): void {
    this.sqlite.close();
  }
  private ensureColumn(
    table: string,
    column: string,
    definition: string,
  ): void {
    const columns = this.sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all() as { name: string }[];
    if (!columns.some((item) => item.name === column))
      this.sqlite.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
  }
  createSession(input: CreateSessionInput): SessionRecord {
    const timestamp = nowIso();
    const projectId = createId();
    const id = createId();
    const tx = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO projects(id,name,repository_path,repository_remote,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(repository_path) DO UPDATE SET name=excluded.name, repository_remote=excluded.repository_remote, updated_at=excluded.updated_at",
        )
        .run(
          projectId,
          input.projectName,
          input.repository,
          input.repositoryRemote ?? null,
          timestamp,
          timestamp,
        );
      const project = this.sqlite
        .prepare("SELECT id FROM projects WHERE repository_path = ?")
        .get(input.repository) as { id: string };
      this.sqlite
        .prepare(
          "INSERT INTO sessions(id,project_id,agent,adapter_version,task_id,task_description,status,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          project.id,
          input.agent,
          input.adapterVersion,
          input.taskId ?? null,
          input.taskDescription ?? null,
          "running",
          timestamp,
          timestamp,
        );
      return {
        id,
        projectId: project.id,
        agent: input.agent,
        adapterVersion: input.adapterVersion,
        taskId: input.taskId ?? null,
        taskDescription: input.taskDescription ?? null,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        durationMs: null,
        childProcessExitCode: null,
        createdAt: timestamp,
      } satisfies SessionRecord;
    });
    return tx();
  }
  appendEvent(input: unknown): TokenFaxxEvent {
    const event = parseEvent(input);
    this.db
      .insert(schema.events)
      .values({
        id: event.id,
        sessionId: event.sessionId,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        timestamp: event.timestamp,
        payload: JSON.stringify(event.payload),
        metadata: JSON.stringify(event.metadata),
      })
      .run();
    const p = event.payload;
    if (event.eventType === "model.usage") {
      const inputTokens = p.inputTokens as number | null;
      const outputTokens = p.outputTokens as number | null;
      const cached = (p.cachedInputTokens as number | null | undefined) ?? null;
      this.db
        .insert(schema.modelUsage)
        .values({
          id: createId(),
          sessionId: event.sessionId,
          provider: String(p.provider),
          model: p.model as string | null,
          inputTokens,
          outputTokens,
          cachedTokens: cached,
          reasoningTokens:
            (p.reasoningTokens as number | null | undefined) ?? null,
          totalTokens:
            (p.totalTokens as number | null | undefined) ??
            (inputTokens === null || outputTokens === null
              ? null
              : inputTokens + outputTokens),
          estimatedCostUsd:
            (p.estimatedCostUsd as number | null | undefined) ?? null,
          costMeasurement: (p.costMeasurement as string | undefined) ?? null,
          costSource: (p.costSource as string | undefined) ?? null,
          pricingEffectiveDate:
            (p.pricingEffectiveDate as string | undefined) ?? null,
          measurementType: String(p.measurement),
          source: (p.source as string | undefined) ?? null,
          timestamp: event.timestamp,
        })
        .run();
    }
    if (event.eventType === "tool.completed")
      this.db
        .insert(schema.toolCalls)
        .values({
          id: createId(),
          sessionId: event.sessionId,
          tool: String(p.tool),
          actionType: String(p.actionType),
          success: Boolean(p.success),
          durationMs: Number(p.durationMs),
          timestamp: event.timestamp,
        })
        .run();
    if (event.eventType === "command.completed")
      this.db
        .insert(schema.commandRuns)
        .values({
          id: createId(),
          sessionId: event.sessionId,
          commandCategory: String(p.category),
          exitCode: p.exitCode as number | null,
          durationMs: Number(p.durationMs),
          status: String(p.status),
          retryNumber: Number(p.retryNumber),
          timestamp: event.timestamp,
        })
        .run();
    if (event.eventType === "task.outcome")
      this.db
        .insert(schema.taskOutcomes)
        .values({
          id: createId(),
          sessionId: event.sessionId,
          status: String(p.status),
          accepted: (p.accepted as boolean | null | undefined) ?? null,
          reason: (p.reason as string | undefined) ?? null,
          evidence: JSON.stringify(p.evidence),
          timestamp: event.timestamp,
        })
        .run();
    if (event.eventType === "analysis.completed")
      this.db
        .insert(schema.analysisSnapshots)
        .values({
          id: createId(),
          sessionId: event.sessionId,
          provider: String(p.provider),
          model: String(p.model),
          generationId: (p.generationId as string | null) ?? null,
          evidenceHash: String(p.evidenceHash),
          schemaVersion: Number(p.schemaVersion),
          analysisJson: JSON.stringify(p.analysis),
          usageJson: JSON.stringify(p.usage),
          createdAt: event.timestamp,
        })
        .run();
    return event;
  }
  addGitSnapshot(
    sessionId: string,
    snapshotType: "before" | "after",
    value: {
      branch: string | null;
      headSha: string | null;
      changedFileCount: number;
      linesAdded: number;
      linesDeleted: number;
      uncommittedChanges: boolean;
      files: unknown[];
    },
  ): void {
    this.db
      .insert(schema.gitSnapshots)
      .values({
        id: createId(),
        sessionId,
        snapshotType,
        branch: value.branch,
        headSha: value.headSha,
        changedFileCount: value.changedFileCount,
        linesAdded: value.linesAdded,
        linesDeleted: value.linesDeleted,
        uncommittedChanges: value.uncommittedChanges,
        statusJson: JSON.stringify(value.files),
        timestamp: nowIso(),
      })
      .run();
  }
  addValidation(
    sessionId: string,
    value: {
      type: string;
      command: string;
      status: string;
      exitCode: number | null;
      durationMs: number;
      startedAt: string;
      completedAt: string;
      details?: unknown;
    },
  ): void {
    this.db
      .insert(schema.validationRuns)
      .values({
        id: createId(),
        sessionId,
        validationType: value.type,
        command: value.command,
        status: value.status,
        exitCode: value.exitCode,
        durationMs: value.durationMs,
        startedAt: value.startedAt,
        completedAt: value.completedAt,
        detailsJson: JSON.stringify(value.details ?? {}),
      })
      .run();
  }
  completeSession(
    id: string,
    status: "completed" | "failed" | "interrupted",
    exitCode: number | null,
  ): void {
    const row = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get();
    if (!row) throw new Error(`Session ${id} was not found`);
    const completedAt = nowIso();
    this.db
      .update(schema.sessions)
      .set({
        status,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(row.startedAt),
        childProcessExitCode: exitCode,
      })
      .where(eq(schema.sessions.id, id))
      .run();
  }
  saveScore(
    sessionId: string,
    score: {
      finalScore: number | null;
      confidence: number;
      components: unknown;
      insufficientData: boolean;
      explanation: string[];
      attribution?: unknown;
      reworkRate?: number | null;
      reworkEvidence?: string[];
      confidences?: unknown;
    },
  ): void {
    this.db
      .delete(schema.scoreSnapshots)
      .where(eq(schema.scoreSnapshots.sessionId, sessionId))
      .run();
    this.db
      .insert(schema.scoreSnapshots)
      .values({
        id: createId(),
        sessionId,
        finalScore: score.finalScore,
        confidence: score.confidence,
        components: JSON.stringify(score.components),
        insufficientData: score.insufficientData,
        explanation: JSON.stringify(score.explanation),
        detailsJson: JSON.stringify({
          attribution: score.attribution,
          reworkRate: score.reworkRate,
          reworkEvidence: score.reworkEvidence,
          confidences: score.confidences,
        }),
        calculatedAt: nowIso(),
      })
      .run();
  }
  listSessions(
    filters: { agent?: string; taskId?: string; limit?: number } = {},
  ): SessionRecord[] {
    const clauses = [];
    if (filters.agent) clauses.push(eq(schema.sessions.agent, filters.agent));
    if (filters.taskId)
      clauses.push(eq(schema.sessions.taskId, filters.taskId));
    return this.db
      .select()
      .from(schema.sessions)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(schema.sessions.startedAt))
      .limit(filters.limit ?? 20)
      .all() as SessionRecord[];
  }
  getBundle(id?: string): SessionBundle | null {
    const session = id
      ? this.db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, id))
          .get()
      : this.db
          .select()
          .from(schema.sessions)
          .orderBy(desc(schema.sessions.startedAt))
          .limit(1)
          .get();
    if (!session) return null;
    const rawEvents = this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.sessionId, session.id))
      .all();
    return {
      session: session as SessionRecord,
      events: rawEvents.map((e) =>
        parseEvent({
          id: e.id,
          schemaVersion: e.schemaVersion,
          sessionId: e.sessionId,
          timestamp: e.timestamp,
          agent: session.agent,
          repository: this.projectPath(session.projectId),
          taskId: session.taskId ?? undefined,
          eventType: e.eventType,
          payload: JSON.parse(e.payload),
          metadata: JSON.parse(e.metadata),
        }),
      ),
      validations: this.db
        .select()
        .from(schema.validationRuns)
        .where(eq(schema.validationRuns.sessionId, session.id))
        .all(),
      gitSnapshots: this.db
        .select()
        .from(schema.gitSnapshots)
        .where(eq(schema.gitSnapshots.sessionId, session.id))
        .all(),
      usage: this.db
        .select()
        .from(schema.modelUsage)
        .where(eq(schema.modelUsage.sessionId, session.id))
        .all(),
      score:
        this.db
          .select()
          .from(schema.scoreSnapshots)
          .where(eq(schema.scoreSnapshots.sessionId, session.id))
          .get() ?? null,
      outcome:
        this.db
          .select()
          .from(schema.taskOutcomes)
          .where(eq(schema.taskOutcomes.sessionId, session.id))
          .orderBy(desc(schema.taskOutcomes.timestamp))
          .get() ?? null,
      analyses: this.db
        .select()
        .from(schema.analysisSnapshots)
        .where(eq(schema.analysisSnapshots.sessionId, session.id))
        .orderBy(desc(schema.analysisSnapshots.createdAt))
        .all(),
    };
  }
  private projectPath(id: string): string {
    return (
      this.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, id))
        .get()?.repositoryPath ?? "unknown"
    );
  }
  deleteSession(id: string): boolean {
    return (
      this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run()
        .changes > 0
    );
  }
  deleteAll(): void {
    this.sqlite.transaction(() => {
      this.sqlite.exec("DELETE FROM sessions; DELETE FROM projects;");
    })();
  }
  applyRetention(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db
      .delete(schema.sessions)
      .where(lt(schema.sessions.startedAt, cutoff))
      .run().changes;
  }
}
