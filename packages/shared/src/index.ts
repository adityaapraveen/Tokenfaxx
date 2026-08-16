import { randomUUID } from "node:crypto";

export const createId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, value));

const SECRET_KEY =
  /(api[_-]?key|authorization|password|secret|token|credential)/i;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(item),
      ]),
    );
  }
  return value;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[\",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
