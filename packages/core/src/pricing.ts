import type { TokenFaxxConfig } from "./config.js";

export interface UsageForPricing {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}
export interface CalculatedCost {
  usd: number;
  measurement: "calculated";
  source: string;
  effectiveDate?: string;
  userSupplied: true;
}

export function calculateConfiguredCost(
  usage: UsageForPricing,
  config: TokenFaxxConfig,
): CalculatedCost | null {
  const price = config.pricing.custom.find(
    (item) => item.provider === usage.provider && item.model === usage.model,
  );
  if (!price) return null;
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const regularInput = usage.inputTokens - cached;
  const usd =
    (regularInput * price.inputPerMillionUsd +
      cached * (price.cachedInputPerMillionUsd ?? price.inputPerMillionUsd) +
      usage.outputTokens * price.outputPerMillionUsd) /
    1_000_000;
  return {
    usd,
    measurement: "calculated",
    source: price.source ?? "user configuration",
    ...(price.effectiveDate ? { effectiveDate: price.effectiveDate } : {}),
    userSupplied: true,
  };
}
