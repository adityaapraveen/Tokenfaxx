import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";

describe("configuration", () => {
  it("rejects weights that do not total one", () => {
    expect(() =>
      defineConfig({
        scoring: {
          weights: {
            outcome: 1,
            validationQuality: 1,
            tokenEfficiency: 1,
            costEfficiency: 1,
            rework: 1,
            attributionConfidence: 1,
          },
        },
      }),
    ).toThrow(/total 1/);
  });
  it("enforces privacy-safe defaults", () => {
    expect(defineConfig({}).privacy.storeTerminalOutput).toBe(false);
    expect(defineConfig({}).analysis.enabled).toBe(false);
  });
  it("rejects ambiguous duplicate model pricing", () => {
    expect(() =>
      defineConfig({
        pricing: {
          custom: [
            {
              provider: "openai",
              model: "model-a",
              inputPerMillionUsd: 1,
              outputPerMillionUsd: 2,
            },
            {
              provider: "openai",
              model: "model-a",
              inputPerMillionUsd: 3,
              outputPerMillionUsd: 4,
            },
          ],
        },
      }),
    ).toThrow(/Duplicate pricing/);
  });
});
