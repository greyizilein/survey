import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic, anthropic } from "@ai-sdk/anthropic";
import { STREAM_ERROR_MARKER } from "./stream-error-marker";

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

/**
 * The Vercel AI SDK's Anthropic provider has no Files API / container-upload / Agent Skills
 * support, so raw-document sandbox ingestion needs the official Anthropic SDK directly.
 */
export async function createRawAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: key });
}

/**
 * Claude has no native image-generation model, so real figures/illustrations are
 * routed through the gateway to a dedicated image model instead. gpt-image-1 is the
 * pick for academic figures specifically: it renders in-image text (axis labels,
 * flowchart node names, legends) far more reliably than Imagen, which matters for
 * diagrams and schematics that need to be legible, not just pretty.
 */
export const FIGURE_IMAGE_MODEL = "openai/gpt-image-1";

export function figureImageModel() {
  return createAi().image(FIGURE_IMAGE_MODEL);
}

/**
 * StreamText's own toTextStreamResponse() silently swallows mid-stream provider errors
 * (e.g. invalid key, no access to a beta tool, rate limiting) — the response stays a 200
 * with whatever text streamed before the error, so the client sees a truncated/empty
 * answer with no way to tell something failed. This wraps the stream so a mid-stream
 * error is appended as a plain-text marker the client can detect and surface for real.
 */
export { STREAM_ERROR_MARKER } from "./stream-error-marker";

export function toTextStreamResponseWithErrors(
  result: { fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown }> },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta" && part.text) {
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            const message = part.error instanceof Error ? part.error.message : String(part.error);
            controller.enqueue(encoder.encode(`${STREAM_ERROR_MARKER}${message}`));
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Generation failed";
        controller.enqueue(encoder.encode(`${STREAM_ERROR_MARKER}${message}`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

