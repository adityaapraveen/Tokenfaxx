import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "@tokenfaxx/core";
import { TokenFaxxDatabase } from "@tokenfaxx/storage";
import { TokenFaxx } from "./index.js";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { recursive: true, force: true }),
    ),
);

function repository(): { directory: string; databasePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tokenfaxx-sdk-"));
  directories.push(directory);
  return {
    directory,
    databasePath: path.join(directory, ".tokenfaxx", "tokenfaxx.db"),
  };
}

describe("SDK configured pricing", () => {
  it("calculates missing cost and persists independent provenance", async () => {
    const { directory, databasePath } = repository();
    const tracker = new TokenFaxx({
      agent: "test-agent",
      repository: directory,
      config: defineConfig({
        pricing: {
          custom: [
            {
              provider: "openai",
              model: "model-a",
              inputPerMillionUsd: 2,
              cachedInputPerMillionUsd: 0.5,
              outputPerMillionUsd: 4,
              effectiveDate: "2026-08-01",
              source: "team pricing policy",
            },
          ],
        },
      }),
    });
    const session = await tracker.startSession();
    await session.recordModelUsage({
      provider: "openai",
      model: "model-a",
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 250_000,
      measurement: "reported",
      source: "official provider response",
    });
    tracker.close();

    const db = new TokenFaxxDatabase(databasePath);
    const usage = db.getBundle(session.id)?.usage[0];
    expect(usage).toMatchObject({
      estimatedCostUsd: 2.4,
      costMeasurement: "calculated",
      costSource: "team pricing policy",
      pricingEffectiveDate: "2026-08-01",
      measurementType: "reported",
      source: "official provider response",
    });
    db.close();
  });

  it("never overwrites a cost supplied by the SDK caller", async () => {
    const { directory, databasePath } = repository();
    const tracker = new TokenFaxx({
      agent: "test-agent",
      repository: directory,
      config: defineConfig({
        pricing: {
          custom: [
            {
              provider: "openai",
              model: "model-a",
              inputPerMillionUsd: 100,
              outputPerMillionUsd: 100,
            },
          ],
        },
      }),
    });
    const session = await tracker.startSession();
    await session.recordModelUsage({
      provider: "openai",
      model: "model-a",
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostUsd: 0.0123,
      costMeasurement: "provider-reported",
      costSource: "provider invoice API",
      measurement: "reported",
    });
    tracker.close();

    const db = new TokenFaxxDatabase(databasePath);
    expect(db.getBundle(session.id)?.usage[0]).toMatchObject({
      estimatedCostUsd: 0.0123,
      costMeasurement: "provider-reported",
      costSource: "provider invoice API",
    });
    db.close();
  });
});
