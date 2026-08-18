import { describe, expect, it } from "vitest";
import { redactSecrets } from "./index.js";

describe("secret redaction", () => {
  it("redacts credential keys across common naming conventions", () => {
    expect(
      redactSecrets({
        apiKey: "one",
        access_token: "two",
        githubToken: "three",
        nested: { password: "four" },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      access_token: "[REDACTED]",
      githubToken: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  it("preserves token-count measurements", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cachedInputTokens: 250,
      reasoningTokens: 100,
      totalTokens: 1_500,
    };
    expect(redactSecrets(usage)).toEqual(usage);
  });
});
