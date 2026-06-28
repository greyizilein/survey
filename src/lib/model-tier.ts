export type ModelTier = "fast" | "pro" | "max";

export const MODEL_TIER_COOKIE = "model-tier";

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  pro: "Pro",
  max: "Max",
};

export const MODEL_TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  fast: "GPT-5.1 — quick, low-cost model for planning, writing, and drawing.",
  pro: "GPT-5.1 Pro — higher-effort reasoning for precise, detailed results.",
  max: "Claude orchestrating tools and sub-models — today's full-power mode.",
};

/** Text-generation model id per tier, resolved through the AI Gateway. */
export const TEXT_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "openai/gpt-5.1",
  pro: "openai/gpt-5.1-pro",
  max: "anthropic/claude-sonnet-4.6",
};

/** Image-generation model id per tier, resolved through the AI Gateway. */
export const IMAGE_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "google/imagen-4.0-fast-generate-001",
  pro: "openai/gpt-image-1",
  max: "openai/gpt-image-1",
};
