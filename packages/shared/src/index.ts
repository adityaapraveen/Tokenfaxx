import { randomUUID } from "node:crypto";

export const createId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, value));

const isSecretKey = (key: string): boolean => {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
  return /(^|_)(api_key|authorization|password|passwd|secret|credential|private_key|access_token|refresh_token|auth_token|token)($|_)/.test(
    normalized,
  );
};
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretKey(key) ? "[REDACTED]" : redactSecrets(item),
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
