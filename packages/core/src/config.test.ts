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
});
