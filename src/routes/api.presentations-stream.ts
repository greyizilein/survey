import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { PresentationChatInput, buildPresentationPrompt } from "@/lib/presentations.functions";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/presentations-stream")({
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

        const parsed = PresentationChatInput.safeParse(body);
        if (!parsed.success) {
          return new Response(`Invalid input: ${parsed.error.message}`, { status: 400 });
        }

        const { createAi } = await import("@/lib/ai-gateway.server");
        const { streamText } = await import("ai");
        const ai = createAi();

        const { model, prompt } = await buildPresentationPrompt(parsed.data);

        const result = streamText({ model: ai(model), prompt, temperature: 0.3, maxOutputTokens: 8000 });
        return result.toTextStreamResponse();
      },
    },
  },
});
