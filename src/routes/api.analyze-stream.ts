import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { AnalyzeChatInput, buildAnalyzePrompt } from "@/lib/analyze.functions";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/analyze-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server misconfigured", { status: 500 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.replace("Bearer ", "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
        if (claimsError || !claimsData?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        const parsed = AnalyzeChatInput.safeParse(body);
        if (!parsed.success) {
          const tooManyMessages = parsed.error.issues.some(
            (i) => i.path[0] === "messages" && i.code === "too_big",
          );
          if (tooManyMessages) {
            return new Response(
              "This conversation has gotten very long. Please start a new chat to continue — your existing work is still saved.",
              { status: 400 },
            );
          }
          return new Response("Invalid input. Please try again or start a new chat.", { status: 400 });
        }

        const { createCodeExecutionAi, getModelTier, codeExecutionTool, webSearchTool, webFetchTool, toTextStreamResponseWithToolFallback } = await import("@/lib/ai-gateway.server");
        const { streamText } = await import("ai");

        try {
          const { model, prompt, promptCached, promptDynamic, useCodeExecution, useWebSearch } =
            await buildAnalyzePrompt(parsed.data, supabase);
          const tier = getModelTier();

          // All tiers now use direct Anthropic so prompt caching applies across Fast/Pro/Max —
          // the large per-turn-identical prefix is billed once per ~5 min instead of every turn.
          const useCachedPrompt = promptCached.length > 0;

          // Max tier: adaptive extended thinking with high effort — temperature must be 1.
          // Pro tier: standard Sonnet with code execution, no thinking — temperature 0.2.
          // Fast tier: Haiku with web search only, no code execution — temperature 0.2.
          const isMax = tier === "max";

          const makeResult = (withTools: boolean) =>
            streamText({
              model: createCodeExecutionAi()(model),
              ...(useCachedPrompt
                ? {
                    messages: [
                      {
                        role: "user" as const,
                        content: [
                          {
                            type: "text" as const,
                            text: promptCached,
                            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
                          },
                          { type: "text" as const, text: promptDynamic },
                        ],
                      },
                    ],
                  }
                : { prompt }),
              temperature: isMax ? 1 : 0.2,
              maxOutputTokens: 16000,
              ...(isMax
                ? { providerOptions: { anthropic: { thinking: { type: "adaptive", effort: "high" } } } }
                : {}),
              ...(withTools && (useCodeExecution || useWebSearch)
                ? {
                    tools: {
                      ...(useCodeExecution ? { code_execution: codeExecutionTool() } : {}),
                      ...(useWebSearch ? { web_search: webSearchTool(), web_fetch: webFetchTool() } : {}),
                    },
                  }
                : {}),
              onError: ({ error }) => {
                console.error("[analyze-stream] generation error:", error);
              },
            });
          return toTextStreamResponseWithToolFallback(makeResult(true), () => makeResult(false));
        } catch (e) {
          console.error("[analyze-stream] setup error:", e);
          return new Response(e instanceof Error ? e.message : "Failed to start generation", { status: 500 });
        }
      },
    },
  },
});
