import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic, anthropic } from "@ai-sdk/anthropic";
import { getCookie } from "@tanstack/react-start/server";
import { STREAM_ERROR_MARKER, STREAM_TRUNCATED_MARKER } from "./stream-error-marker";
import { MODEL_TIER_COOKIE, TEXT_MODEL_BY_TIER, IMAGE_MODEL_BY_TIER, type ModelTier } from "./model-tier";

export function createAi() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY missing");
  return createGateway({ apiKey: key });
}

/** Reads the user's Fast/Pro/Max choice from the cookie the client sets; defaults to Max. */
export function getModelTier(): ModelTier {
  const raw = getCookie(MODEL_TIER_COOKIE);
  return raw === "fast" || raw === "pro" || raw === "max" ? raw : "max";
}

/** Text model for the current tier — use this instead of DEFAULT_MODEL in new call sites. */
export function textModelForTier(tier: ModelTier = getModelTier()): string {
  return TEXT_MODEL_BY_TIER[tier];
}

/** Image model for the current tier — use this instead of FIGURE_IMAGE_MODEL in new call sites. */
export function imageModelForTier(tier: ModelTier = getModelTier()): string {
  return IMAGE_MODEL_BY_TIER[tier];
}

/** @deprecated kept for any straggler import; resolves the Max-tier model. Prefer textModelForTier(). */
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

/**
 * Direct Anthropic model string for Fast tier (Sonnet 4.6). No provider prefix — used with
 * createCodeExecutionAi(), not the gateway, so native tools (webSearch, webFetch) work.
 */
export const FAST_MODEL = "claude-sonnet-4-6";

/**
 * Fixed cheap model for mechanical reading/extraction tasks (e.g. scanning a brief for
 * required submission fields) that don't need writing quality and shouldn't be tied to
 * the user's selected tier. Independent of ModelTier on purpose.
 */
export const CHEAP_EXTRACTION_MODEL = "google/gemini-2.5-flash-lite";

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

export function figureImageModel(tier: ModelTier = getModelTier()) {
  return createAi().image(imageModelForTier(tier));
}

/**
 * StreamText's own toTextStreamResponse() silently swallows mid-stream provider errors
 * (e.g. invalid key, no access to a beta tool, rate limiting) — the response stays a 200
 * with whatever text streamed before the error, so the client sees a truncated/empty
 * answer with no way to tell something failed. This wraps the stream so a mid-stream
 * error is appended as a plain-text marker the client can detect and surface for real.
 */
export { STREAM_ERROR_MARKER, STREAM_TRUNCATED_MARKER } from "./stream-error-marker";

/**
 * Build a two-part user message that enables Anthropic prompt caching: the first text block
 * (the static prefix — instructions, briefs, source documents that stay byte-identical across
 * calls) is marked with `cacheControl: "ephemeral"`, so Anthropic stores it for ~5 minutes and
 * subsequent requests pay ~10% on the cached portion and read it free instead of re-billing
 * the whole prefix. The second block is the per-request dynamic tail. Anything sized under the
 * model's minimum (1024 tokens on Sonnet, 2048 on Haiku) is a no-op — safe to use anyway.
 *
 * Non-Anthropic providers ignore `providerOptions.anthropic.*`, so the same shape is safe to
 * send through the AI Gateway when the resolved model may not be Claude.
 */
export function buildCachedMessages(staticPrefix: string, dynamicTail: string) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: staticPrefix,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
        },
        { type: "text" as const, text: dynamicTail },
      ],
    },
  ];
}

type StreamPart = {
  type: string;
  text?: string;
  error?: unknown;
  finishReason?: string;
};

export function toTextStreamResponseWithErrors(
  result: { fullStream: AsyncIterable<StreamPart> },
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
          } else if (part.type === "finish" && part.finishReason === "length") {
            controller.enqueue(encoder.encode(STREAM_TRUNCATED_MARKER));
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

/**
 * Some Anthropic API keys (workspace-level "auto-injected tools" policies) silently add a
 * server-side tool to every request. If our own request also explicitly declares a tool with
 * the same name (e.g. "code_execution"), Anthropic rejects the call with "Auto-injecting tools
 * would conflict with existing tool names". Since the auto-injected tool already covers the
 * capability, the fix is to retry once without our own explicit tool declarations.
 */
function isAutoInjectToolConflict(message: string): boolean {
  return /auto-inject(ing)? tools? would conflict/i.test(message);
}

export function toTextStreamResponseWithToolFallback(
  primary: { fullStream: AsyncIterable<StreamPart> },
  makeFallback: () => { fullStream: AsyncIterable<StreamPart> },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let switchedToFallback = false;
      const consume = async (source: AsyncIterable<StreamPart>) => {
        for await (const part of source) {
          if (part.type === "text-delta" && part.text) {
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            const message = part.error instanceof Error ? part.error.message : String(part.error);
            if (!switchedToFallback && isAutoInjectToolConflict(message)) {
              switchedToFallback = true;
              await consume(makeFallback().fullStream);
              return;
            }
            controller.enqueue(encoder.encode(`${STREAM_ERROR_MARKER}${message}`));
          } else if (part.type === "finish" && part.finishReason === "length") {
            controller.enqueue(encoder.encode(STREAM_TRUNCATED_MARKER));
          }
        }
      };
      try {
        await consume(primary.fullStream);
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

