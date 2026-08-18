import path from "node:path";
import {
  calculateConfiguredCost,
  defaultConfig,
  EVENT_SCHEMA_VERSION,
  type EventType,
  type SessionStatus,
  taskProfileSchema,
  type TaskOutcomeStatus,
  type TaskProfile,
  type TokenFaxxConfig,
} from "@tokenfaxx/core";
import { createId, nowIso, redactSecrets } from "@tokenfaxx/shared";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";

export interface TokenFaxxOptions {
  agent: string;
  repository: string;
  adapterVersion?: string;
  databasePath?: string;
  config?: TokenFaxxConfig;
}
export interface StartSessionOptions {
  taskId?: string;
  taskDescription?: string;
  taskProfile?: Partial<TaskProfile>;
}
export interface ModelUsage {
  provider: string;
  model?: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  costMeasurement?: "provider-reported" | "calculated" | "estimated";
  costSource?: string;
  pricingEffectiveDate?: string;
  measurement: "exact" | "reported" | "calculated" | "estimated";
  source?: string;
}
export class TrackedSession {
  constructor(
    readonly id: string,
    private readonly options: TokenFaxxOptions,
    private readonly db: TokenFaxxDatabase,
    private readonly config: TokenFaxxConfig,
    private readonly taskId?: string,
  ) {}
  private record(
    eventType: EventType,
    payload: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
  ): void {
    this.db.appendEvent({
      id: createId(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      sessionId: this.id,
      timestamp: nowIso(),
      agent: this.options.agent,
      repository: this.options.repository,
      ...(this.taskId ? { taskId: this.taskId } : {}),
      eventType,
      payload: redactSecrets(payload),
      metadata: redactSecrets(metadata),
    });
  }
  async recordModelUsage(usage: ModelUsage): Promise<void> {
    let recorded: ModelUsage = usage;
    if (
      usage.estimatedCostUsd == null &&
      usage.model != null &&
      usage.inputTokens != null &&
      usage.outputTokens != null
    ) {
      const calculated = calculateConfiguredCost(
        {
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.cachedInputTokens != null
            ? { cachedInputTokens: usage.cachedInputTokens }
            : {}),
        },
        this.config,
      );
      if (calculated)
        recorded = {
          ...usage,
          estimatedCostUsd: calculated.usd,
          costMeasurement: calculated.measurement,
          costSource: calculated.source,
          ...(calculated.effectiveDate
            ? { pricingEffectiveDate: calculated.effectiveDate }
            : {}),
        };
    } else if (usage.estimatedCostUsd != null && !usage.costMeasurement) {
      recorded = {
        ...usage,
        costMeasurement: "estimated",
        costSource: usage.costSource ?? usage.source ?? "SDK caller",
      };
    }
    this.record("model.usage", recorded as unknown as Record<string, unknown>);
  }
  async recordToolCall(call: {
    tool: string;
    actionType: string;
    success: boolean;
    durationMs: number;
  }): Promise<void> {
    this.record("tool.completed", call);
  }
  async recordEvent(
    eventType: EventType,
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.record(eventType, payload, metadata);
  }
  async recordOutcome(outcome: {
    status: TaskOutcomeStatus;
    accepted?: boolean | null;
    reason?: string;
    evidence?: string[];
  }): Promise<void> {
    this.record("task.outcome", {
      status: outcome.status,
      accepted: outcome.accepted ?? null,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      evidence: outcome.evidence ?? [],
    });
  }
  async complete(result: {
    status: Exclude<SessionStatus, "running">;
    exitCode?: number | null;
    taskOutcome?: TaskOutcomeStatus;
  }): Promise<void> {
    const bundle = this.db.getBundle(this.id);
    if (!bundle) throw new Error(`Session ${this.id} no longer exists`);
    const durationMs = Date.now() - Date.parse(bundle.session.startedAt);
    this.record("session.completed", {
      status: result.status,
      exitCode: result.exitCode ?? null,
      durationMs,
    });
    if (result.taskOutcome)
      await this.recordOutcome({
        status: result.taskOutcome,
        evidence: ["Explicitly reported by SDK caller"],
      });
    this.db.completeSession(this.id, result.status, result.exitCode ?? null);
  }
}
export class TokenFaxx {
  private readonly db: TokenFaxxDatabase;
  private readonly config: TokenFaxxConfig;
  constructor(private readonly options: TokenFaxxOptions) {
    this.config = options.config ?? defaultConfig();
    this.db = new TokenFaxxDatabase(
      options.databasePath ??
        path.join(options.repository, ".tokenfaxx", "tokenfaxx.db"),
    );
  }
  async startSession(input: StartSessionOptions = {}): Promise<TrackedSession> {
    const row = this.db.createSession({
      repository: this.options.repository,
      projectName: path.basename(this.options.repository),
      agent: this.options.agent,
      adapterVersion: this.options.adapterVersion ?? "sdk-1.0.0",
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.taskDescription
        ? { taskDescription: input.taskDescription }
        : {}),
    });
    const session = new TrackedSession(
      row.id,
      this.options,
      this.db,
      this.config,
      input.taskId,
    );
    await session.recordEvent("session.started", {
      adapterVersion: this.options.adapterVersion ?? "sdk-1.0.0",
    });
    await session.recordEvent(
      "task.profiled",
      taskProfileSchema.parse(input.taskProfile ?? {}),
    );
    return session;
  }
  close(): void {
    this.db.close();
  }
}
