export interface ProviderUsageSnapshot {
  provider: "openai" | "anthropic";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  source: string;
}

const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const money = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function usageFrom(
  value: unknown,
  aliases: {
    input: string[];
    output: string[];
    cached: string[];
    reasoning: string[];
    total: string[];
  },
): Omit<ProviderUsageSnapshot, "provider" | "model" | "estimatedCostUsd" | "source"> | null {
  const item = record(value);
  if (!item) return null;
  const first = (keys: string[]): number | null => {
    for (const key of keys) {
      const parsed = integer(item[key]);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const inputTokens = first(aliases.input);
  const outputTokens = first(aliases.output);
  const cachedInputTokens = first(aliases.cached);
  const reasoningTokens = first(aliases.reasoning);
  const explicitTotal = first(aliases.total);
  if (
    inputTokens === null &&
    outputTokens === null &&
    cachedInputTokens === null &&
    reasoningTokens === null &&
    explicitTotal === null
  )
    return null;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens:
      explicitTotal ??
      (inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null),
  };
}

const codexAliases = {
  input: ["input_tokens", "inputTokens"],
  output: ["output_tokens", "outputTokens"],
  cached: ["cached_input_tokens", "cachedInputTokens"],
  reasoning: ["reasoning_output_tokens", "reasoning_tokens", "reasoningTokens"],
  total: ["total_tokens", "totalTokens"],
};
const claudeAliases = {
  input: ["input_tokens", "inputTokens"],
  output: ["output_tokens", "outputTokens"],
  cached: ["cache_read_input_tokens", "cached_input_tokens", "cachedInputTokens"],
  reasoning: ["reasoning_tokens", "reasoningTokens"],
  total: ["total_tokens", "totalTokens"],
};

export class StructuredTelemetryCollector {
  private snapshotValue: ProviderUsageSnapshot | null = null;
  private readonly claudeMessages = new Map<string, ProviderUsageSnapshot>();

  constructor(private readonly provider: "codex" | "claude") {}

  consume(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const item = record(parsed);
    if (!item) return;
    if (this.provider === "codex") this.consumeCodex(item);
    else this.consumeClaude(item);
  }

  snapshot(): ProviderUsageSnapshot | null {
    if (this.snapshotValue) return { ...this.snapshotValue };
    if (this.provider !== "claude" || this.claudeMessages.size === 0) return null;
    const rows = [...this.claudeMessages.values()];
    const sum = (key: keyof ProviderUsageSnapshot): number | null => {
      const values = rows.map((row) => row[key]).filter((value): value is number => typeof value === "number");
      return values.length ? values.reduce((total, value) => total + value, 0) : null;
    };
    const inputTokens = sum("inputTokens");
    const outputTokens = sum("outputTokens");
    return {
      provider: "anthropic",
      model: rows.find((row) => row.model)?.model ?? null,
      inputTokens,
      outputTokens,
      cachedInputTokens: sum("cachedInputTokens"),
      reasoningTokens: sum("reasoningTokens"),
      totalTokens:
        inputTokens !== null && outputTokens !== null
          ? inputTokens + outputTokens
          : sum("totalTokens"),
      estimatedCostUsd: null,
      source: "Claude stream-json assistant usage",
    };
  }

  private consumeCodex(item: Record<string, unknown>): void {
    const params = record(item.params);
    const turn = record(item.turn) ?? record(params?.turn);
    const tokenUsage = record(params?.tokenUsage) ?? record(params?.usage);
    const usage =
      usageFrom(item.usage, codexAliases) ??
      usageFrom(turn?.usage, codexAliases) ??
      usageFrom(tokenUsage?.total, codexAliases) ??
      usageFrom(tokenUsage, codexAliases);
    const type = text(item.type) ?? text(item.method);
    if (
      !usage ||
      (type !== "turn.completed" && type !== "thread/tokenUsage/updated")
    )
      return;
    this.snapshotValue = {
      provider: "openai",
      model: text(item.model) ?? text(turn?.model) ?? text(params?.model),
      ...usage,
      estimatedCostUsd: money(item.total_cost_usd) ?? money(item.cost_usd),
      source: type === "thread/tokenUsage/updated" ? "Codex app-server token usage" : "Codex JSONL turn usage",
    };
  }

  private consumeClaude(item: Record<string, unknown>): void {
    const type = text(item.type);
    const message = record(item.message);
    if (type === "result") {
      const usage = usageFrom(item.usage, claudeAliases);
      if (!usage) return;
      this.snapshotValue = {
        provider: "anthropic",
        model: text(item.model) ?? text(message?.model),
        ...usage,
        estimatedCostUsd: money(item.total_cost_usd) ?? money(item.cost_usd),
        source: "Claude stream-json result usage",
      };
      return;
    }
    if (type !== "assistant" || !message) return;
    const usage = usageFrom(message.usage, claudeAliases);
    const id = text(message.id);
    if (!usage || !id) return;
    this.claudeMessages.set(id, {
      provider: "anthropic",
      model: text(message.model),
      ...usage,
      estimatedCostUsd: null,
      source: "Claude stream-json assistant usage",
    });
  }
}
