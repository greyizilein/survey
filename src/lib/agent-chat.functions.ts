import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createAgentSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { createAgentSession } = await import("./managed-agent.server");
    const sessionId = await createAgentSession();
    return { sessionId };
  });
