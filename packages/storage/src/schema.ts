import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repositoryPath: text("repository_path").notNull().unique(),
  repositoryRemote: text("repository_remote"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    taskId: text("task_id"),
    taskDescription: text("task_description"),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    heartbeatAt: text("heartbeat_at"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    childProcessExitCode: integer("child_process_exit_code"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("sessions_project_started_idx").on(t.projectId, t.startedAt),
    index("sessions_agent_idx").on(t.agent),
    index("sessions_task_idx").on(t.taskId),
  ],
);
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    eventType: text("event_type").notNull(),
    timestamp: text("timestamp").notNull(),
    payload: text("payload").notNull(),
    metadata: text("metadata").notNull(),
  },
  (t) => [
    index("events_session_time_idx").on(t.sessionId, t.timestamp),
    index("events_type_idx").on(t.eventType),
  ],
);
export const modelUsage = sqliteTable(
  "model_usage",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    estimatedCostUsd: real("estimated_cost_usd"),
    costMeasurement: text("cost_measurement"),
    costSource: text("cost_source"),
    pricingEffectiveDate: text("pricing_effective_date"),
    measurementType: text("measurement_type").notNull(),
    source: text("source"),
    timestamp: text("timestamp").notNull(),
  },
  (t) => [index("usage_session_idx").on(t.sessionId)],
);
export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  actionType: text("action_type").notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  timestamp: text("timestamp").notNull(),
});
export const commandRuns = sqliteTable("command_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  commandCategory: text("command_category").notNull(),
  exitCode: integer("exit_code"),
  durationMs: integer("duration_ms").notNull(),
  status: text("status").notNull(),
  retryNumber: integer("retry_number").notNull(),
  timestamp: text("timestamp").notNull(),
});
export const validationRuns = sqliteTable(
  "validation_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    validationType: text("validation_type").notNull(),
    command: text("command").notNull(),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
  },
  (t) => [index("validation_session_idx").on(t.sessionId)],
);
export const gitSnapshots = sqliteTable("git_snapshots", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  snapshotType: text("snapshot_type").notNull(),
  branch: text("branch"),
  headSha: text("head_sha"),
  changedFileCount: integer("changed_file_count").notNull(),
  linesAdded: integer("lines_added").notNull(),
  linesDeleted: integer("lines_deleted").notNull(),
  uncommittedChanges: integer("uncommitted_changes", {
    mode: "boolean",
  }).notNull(),
  statusJson: text("status_json").notNull(),
  timestamp: text("timestamp").notNull(),
});
export const taskOutcomes = sqliteTable("task_outcomes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  accepted: integer("accepted", { mode: "boolean" }),
  reason: text("reason"),
  evidence: text("evidence").notNull(),
  timestamp: text("timestamp").notNull(),
});
export const scoreSnapshots = sqliteTable("score_snapshots", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  finalScore: real("final_score"),
  confidence: real("confidence").notNull(),
  components: text("components").notNull(),
  insufficientData: integer("insufficient_data", { mode: "boolean" }).notNull(),
  explanation: text("explanation").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  calculatedAt: text("calculated_at").notNull(),
});
export const analysisSnapshots = sqliteTable(
  "analysis_snapshots",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    generationId: text("generation_id"),
    evidenceHash: text("evidence_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    analysisJson: text("analysis_json").notNull(),
    usageJson: text("usage_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("analysis_session_idx").on(t.sessionId, t.createdAt)],
);
