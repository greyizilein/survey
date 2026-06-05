import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createAi() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
}

export const DEFAULT_MODEL = "google/gemini-2.5-flash";
