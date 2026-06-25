import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const AgentTurnInput = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(100000),
});

export const Route = createFileRoute("/api/agent-stream")({
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

        const parsed = AgentTurnInput.safeParse(body);
        if (!parsed.success) {
          return new Response(`Invalid input: ${parsed.error.message}`, { status: 400 });
        }

        const { streamAgentTurn } = await import("@/lib/managed-agent.server");
        const { sessionId, message } = parsed.data;

        const encoder = new TextEncoder();
        const readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of streamAgentTurn(sessionId, message)) {
                if (chunk.type === "text" || chunk.type === "status") {
                  controller.enqueue(encoder.encode(chunk.text));
                } else if (chunk.type === "file") {
                  controller.enqueue(encoder.encode(`\n@@FILE@@${JSON.stringify({ fileId: chunk.fileId, filename: chunk.filename })}\n`));
                } else if (chunk.type === "error") {
                  controller.enqueue(encoder.encode(`\n\n_Error: ${chunk.text}_`));
                } else if (chunk.type === "done") {
                  break;
                }
              }
            } catch (err) {
              controller.enqueue(encoder.encode(`\n\n_Error: ${err instanceof Error ? err.message : "Agent stream failed"}_`));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      },
    },
  },
});
