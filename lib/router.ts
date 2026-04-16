// lib/router.ts — message complexity classifier.
// Phase 1: rule-based regex. Phase 2: upgrade to Haiku classification.

export type ComplexityLevel = "lookup" | "task" | "project";
export type ModelTier = "haiku" | "sonnet" | "opus";

export interface ComplexityResult {
  level: ComplexityLevel;
  model: ModelTier;
}

const LOOKUP_PATTERNS: RegExp[] = [
  /^(what|when|where|who|how many|how much|show me|list|find)/i,
  /status of/i,
  /last time/i,
  /do (i|we) have/i,
];

const PROJECT_PATTERNS: RegExp[] = [
  /build|create|design|architect|plan|strategy|analyze|report|rebuild|overhaul/i,
  /annual report/i,
  /grant proposal/i,
  /redesign/i,
  /migrate/i,
];

export function classifyComplexity(
  message: string,
  // orgContext reserved for Phase 2 (Haiku-based classification)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _orgContext?: Record<string, unknown>
): ComplexityResult {
  if (LOOKUP_PATTERNS.some((p) => p.test(message))) {
    return { level: "lookup", model: "haiku" };
  }
  if (PROJECT_PATTERNS.some((p) => p.test(message))) {
    return { level: "project", model: "opus" };
  }
  return { level: "task", model: "sonnet" };
}
