export type ModelTier = "fast" | "pro" | "max";

export const MODEL_TIER_COOKIE = "model-tier";

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  pro: "Pro",
  max: "Max",
};

export const MODEL_TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  fast: "Claude Haiku 3.5 — quick, affordable answers with native web search.",
  pro: "Claude Sonnet 4.6 — balanced performance for data analysis with code execution.",
  max: "Claude Sonnet 5.5 — fastest model with exceptional writing and analysis quality.",
};

/** Text-generation model id per tier, resolved through the AI Gateway. */
export const TEXT_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "anthropic/claude-haiku-3-5",
  pro: "anthropic/claude-sonnet-4-6",
  max: "anthropic/claude-sonnet-5-5",
};

/** Image-generation model id per tier, resolved through the AI Gateway. */
export const IMAGE_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "google/imagen-4.0-fast-generate-001",
  pro: "openai/gpt-image-1",
  max: "openai/gpt-image-1",
};
