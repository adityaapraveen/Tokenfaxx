import { TokenFaxx } from "@tokenfaxx/sdk";
// Feed usage returned by the official provider response into TokenFaxx; never estimate absent fields.
const tracker = new TokenFaxx({
  agent: "openai-agent",
  repository: process.cwd(),
});
const session = await tracker.startSession({
  taskDescription: "Example provider-neutral session",
});
await session.recordModelUsage({
  provider: "openai",
  model: null,
  inputTokens: null,
  outputTokens: null,
  measurement: "reported",
  source: "not available in this example",
});
await session.complete({ status: "completed", exitCode: 0 });
tracker.close();
