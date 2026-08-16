import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { calculateConfiguredCost } from "./pricing.js";

describe("configured pricing", () => {
  it("returns null for unknown pricing", () =>
    expect(
      calculateConfiguredCost(
        { provider: "x", model: "y", inputTokens: 1, outputTokens: 1 },
        defineConfig({}),
      ),
    ).toBeNull());
  it("calculates only from user supplied prices", () => {
    const config = defineConfig({
      pricing: {
        custom: [
          {
            provider: "x",
            model: "y",
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 3,
          },
        ],
      },
    });
    expect(
      calculateConfiguredCost(
        {
          provider: "x",
          model: "y",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        },
        config,
      )?.usd,
    ).toBe(4);
  });
});
