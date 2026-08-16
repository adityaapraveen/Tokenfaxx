import { TokenFaxx } from "@tokenfaxx/sdk";
const tracker = new TokenFaxx({
  agent: "custom-agent",
  repository: process.cwd(),
});
const session = await tracker.startSession({
  taskId: "EXAMPLE-1",
  taskDescription: "Demonstrate SDK instrumentation",
  taskProfile: {
    taskType: "other",
    complexity: "small",
    complexitySource: "user",
  },
});
try {
  await session.recordModelUsage({
    provider: "custom",
    model: "company-model",
    inputTokens: 1200,
    outputTokens: 300,
    cachedInputTokens: 200,
    estimatedCostUsd: 0.002,
    measurement: "reported",
    source: "agent callback",
  });
  await session.recordToolCall({
    tool: "terminal",
    actionType: "test",
    success: true,
    durationMs: 250,
  });
  await session.complete({
    status: "completed",
    exitCode: 0,
    taskOutcome: "completed-unverified",
  });
} finally {
  tracker.close();
}
