import { describe, expect, it } from "vitest";
import { ClaudeJsonAdapter, CodexJsonAdapter } from "./index.js";
import { StructuredTelemetryCollector } from "./telemetry.js";

describe("structured provider telemetry", () => {
  it("launches official non-interactive structured modes", () => {
    expect(new CodexJsonAdapter().launch({ passthroughArgs: ["task"] })).toEqual({
      command: "codex",
      args: ["exec", "--json", "task"],
      structuredTelemetry: "codex",
    });
    expect(new ClaudeJsonAdapter().launch({ passthroughArgs: ["task"] })).toEqual({
      command: "claude",
      args: ["-p", "--verbose", "--output-format", "stream-json", "task"],
      structuredTelemetry: "claude",
    });
  });

  it("keeps the latest cumulative Codex usage instead of double counting", () => {
    const collector = new StructuredTelemetryCollector("codex");
    collector.consume(JSON.stringify({ type: "turn.completed", model: "gpt-5", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } }));
    collector.consume(JSON.stringify({ type: "turn.completed", model: "gpt-5", usage: { input_tokens: 180, cached_input_tokens: 40, output_tokens: 25, reasoning_output_tokens: 5 } }));
    expect(collector.snapshot()).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      inputTokens: 180,
      outputTokens: 25,
      cachedInputTokens: 40,
      reasoningTokens: 5,
      totalTokens: 205,
    });
  });

  it("accepts Codex app-server token usage notifications", () => {
    const collector = new StructuredTelemetryCollector("codex");
    collector.consume(JSON.stringify({ method: "thread/tokenUsage/updated", params: { model: "gpt-5", tokenUsage: { total: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } } } }));
    expect(collector.snapshot()).toMatchObject({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });

  it("deduplicates repeated Claude assistant chunks by message ID", () => {
    const collector = new StructuredTelemetryCollector("claude");
    const message = { type: "assistant", message: { id: "msg-1", model: "claude-sonnet", usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 } } };
    collector.consume(JSON.stringify(message));
    collector.consume(JSON.stringify(message));
    collector.consume(JSON.stringify({ type: "assistant", message: { id: "msg-2", model: "claude-sonnet", usage: { input_tokens: 20, output_tokens: 5 } } }));
    expect(collector.snapshot()).toMatchObject({ inputTokens: 120, outputTokens: 15, cachedInputTokens: 50, totalTokens: 135 });
  });

  it("prefers Claude final result usage and reported cost", () => {
    const collector = new StructuredTelemetryCollector("claude");
    collector.consume(JSON.stringify({ type: "assistant", message: { id: "msg-1", usage: { input_tokens: 100, output_tokens: 10 } } }));
    collector.consume(JSON.stringify({ type: "result", model: "claude-sonnet", total_cost_usd: 0.12, usage: { input_tokens: 150, output_tokens: 30, cache_read_input_tokens: 80 } }));
    expect(collector.snapshot()).toMatchObject({ inputTokens: 150, outputTokens: 30, cachedInputTokens: 80, estimatedCostUsd: 0.12 });
  });

  it("ignores malformed and unrelated lines", () => {
    const collector = new StructuredTelemetryCollector("codex");
    collector.consume("not json");
    collector.consume(JSON.stringify({ type: "item.completed", usage: { input_tokens: 1 } }));
    expect(collector.snapshot()).toBeNull();
  });
});
