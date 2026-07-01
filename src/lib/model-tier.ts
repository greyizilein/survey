export type ModelTier = "fast" | "pro" | "max";

export const MODEL_TIER_COOKIE = "model-tier";

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  pro: "Pro",
  max: "Max",
};

export const MODEL_TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  fast: "Claude Sonnet 4.6 — premium quality, direct output, no thinking overhead.",
  pro: "Claude Sonnet 4.6 with adaptive thinking — deeper reasoning for complex tasks.",
  max: "Claude Sonnet 5.5 with adaptive thinking — latest model, exceptional quality.",
};

/** Text-generation model id per tier, resolved through the AI Gateway. */
export const TEXT_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "anthropic/claude-sonnet-4-6",
  pro: "anthropic/claude-sonnet-4-6",
  max: "anthropic/claude-sonnet-5-5",
};

/** Image-generation model id per tier, resolved through the AI Gateway. */
export const IMAGE_MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "google/imagen-4.0-fast-generate-001",
  pro: "openai/gpt-image-1",
  max: "openai/gpt-image-1",
};
