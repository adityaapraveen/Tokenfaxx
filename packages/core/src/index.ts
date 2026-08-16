export * from "./config.js";
export * from "./events.js";
export * from "./pricing.js";
export * from "./integrations.js";
export * from "./benchmark.js";
export * from "./evidence.js";

export class TokenFaxxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TokenFaxxError";
  }
}

export type SessionStatus = "running" | "completed" | "failed" | "interrupted";
export interface SessionRecord {
  id: string;
  projectId: string;
  agent: string;
  adapterVersion: string;
  taskId: string | null;
  taskDescription: string | null;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  childProcessExitCode: number | null;
  createdAt: string;
}
