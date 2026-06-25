import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const FeedbackItem = z.object({
  id: z.string(),
  type: z.enum(["comment", "insertion", "deletion", "note"]),
  comment: z.string(),
  target_excerpt: z.string().optional(),
  suggested_replacement: z.string().optional(),
  scope: z.enum(["local", "document"]).optional(),
});

const ApplyInput = z.object({
  documentTitle: z.string().max(300).optional(),
  documentText: z.string().min(1).max(200000),
  feedbackItems: z.array(FeedbackItem).min(1).max(60),
});

export const Route = createFileRoute("/api/apply-corrections-stream")({
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
        const parsed = ApplyInput.safeParse(body);
        if (!parsed.success) {
          return new Response(`Invalid input: ${parsed.error.message}`, { status: 400 });
        }
        const { documentTitle, documentText, feedbackItems } = parsed.data;

        const { createCodeExecutionAi, CODE_EXECUTION_MODEL } = await import("@/lib/ai-gateway.server");
        const { streamText } = await import("ai");

        const itemsBlock = feedbackItems
          .map((it, i) => {
            const scope = it.scope === "document" ? "apply as a document-wide instruction" : "fix only the targeted passage";
            const parts = [`${i + 1}. [${it.id}] (${it.type}, ${scope}) ${it.comment}`];
            if (it.target_excerpt) parts.push(`   Target passage: "${it.target_excerpt}"`);
            if (it.suggested_replacement) parts.push(`   Suggested replacement: "${it.suggested_replacement}"`);
            return parts.join("\n");
          })
          .join("\n");

        const prompt = `You are revising a written document to apply a reviewer's/supervisor's corrections, surgically and precisely.

DOCUMENT: "${documentTitle ?? "Untitled document"}"
"""
${documentText}
"""

CORRECTIONS TO APPLY
${itemsBlock}

Instructions:
- Apply every correction listed above. For passage-targeted corrections, find the actual passage in the document (it may be paraphrased in the instruction) and revise only what's needed to satisfy the instruction — never rewrite unrelated text.
- For "insertion" items, insert the new content at the most natural location and integrate it so it reads as part of the original prose.
- For "deletion" items, remove the targeted content cleanly and rejoin the surrounding sentences so the result still flows.
- For "note" items (document-wide instructions), apply the instruction consistently across the whole document.
- Preserve everything else in the document exactly as written — voice, structure, and any references/bibliography section verbatim.
- Self-check your edits against each correction before finishing.
- Output ONLY the full revised document text, start to finish — no preamble, no commentary, no markdown code fences.
- After the revised document, on its own line, add an HTML comment listing which correction IDs you applied, in this exact form: <!-- CORRECTIONS_LOG Applied: id1, id2, id3 -->`;

        try {
          const result = streamText({
            model: createCodeExecutionAi()(CODE_EXECUTION_MODEL),
            prompt,
            temperature: 0.2,
            maxOutputTokens: 8000,
            onError: ({ error }) => {
              console.error("[apply-corrections-stream] generation error:", error);
            },
          });
          return result.toTextStreamResponse();
        } catch (e) {
          console.error("[apply-corrections-stream] setup error:", e);
          return new Response(e instanceof Error ? e.message : "Failed to start generation", { status: 500 });
        }
      },
    },
  },
});
