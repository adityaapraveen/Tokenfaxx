export interface OutcomeEnrichment {
  provider: string;
  pullRequestNumber?: number;
  pullRequestStatus?: string;
  ciResult?: string;
  reviewStatus?: string;
  mergeStatus?: string;
  timeToMergeMs?: number;
  reviewRevisionCount?: number;
  reverted?: boolean;
  evidence: string[];
  observedAt: string;
}
export interface OutcomeEnricher {
  readonly provider: string;
  isConfigured(): Promise<boolean>;
  enrich(input: {
    repository: string;
    branch: string | null;
    commits: string[];
    taskId?: string;
  }): Promise<OutcomeEnrichment | null>;
}
