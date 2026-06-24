import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic, anthropic } from "@ai-sdk/anthropic";

export function createAi() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY missing");
  return createGateway({ apiKey: key });
}

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

/**
 * The AI Gateway only forwards its own first-party tools (perplexity/parallel search) —
 * it does not proxy Anthropic's server-side code-execution sandbox. Real, computed data
 * analysis needs a direct Anthropic connection instead.
 */
export function codeExecutionAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function createCodeExecutionAi() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  return createAnthropic({ apiKey: key });
}

export const CODE_EXECUTION_MODEL = "claude-sonnet-4-6";

export function codeExecutionTool() {
  return anthropic.tools.codeExecution_20250825();
}

export function webSearchTool() {
  return anthropic.tools.webSearch_20260209({ maxUses: 6 });
}

export function webFetchTool() {
  return anthropic.tools.webFetch_20260209({ maxUses: 6 });
}
