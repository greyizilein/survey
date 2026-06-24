import { createGateway } from "@ai-sdk/gateway";

export function createAi() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY missing");
  return createGateway({ apiKey: key });
}

export const DEFAULT_MODEL = "google/gemini-2.5-flash";
