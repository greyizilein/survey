export type ModelTier = "fast" | "pro" | "max";

export const MODEL_TIER_COOKIE = "model-tier";

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  pro: "Pro",
  max: "Max",
};

export const MODEL_TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  fast: "Claude Sonnet 4.5 — fast Sonnet for quick drafts and everyday writing.",
  pro: "Claude Sonnet 4.6 — stronger writing quality with code execution.",
  max: "Claude Sonnet 4.6 — full adaptive reasoning for complex, high-stakes work.",
};

/** Text-generation model id per tier — bare Anthropic model strings, used with createCodeExecutionAi(). */
export const TEXT_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "claude-sonnet-4-5",
  pro: "claude-sonnet-4-6",
  max: "claude-sonnet-4-6",
};

/** Image-generation model id per tier, resolved through the AI Gateway. */
export const IMAGE_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "google/imagen-4.0-fast-generate-001",
  pro: "openai/gpt-image-1",
  max: "openai/gpt-image-1",
};
