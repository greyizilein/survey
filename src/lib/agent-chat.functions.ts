import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const createAgentSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { createAgentSession } = await import("./managed-agent.server");
    const { getModelTier } = await import("./ai-gateway.server");
    const tier = getModelTier();
    const sessionId = await createAgentSession(context.userId, tier);
    return { sessionId };
  });

const DownloadAgentFileInput = z.object({ fileId: z.string().min(1) });

export const downloadAgentFileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DownloadAgentFileInput.parse(d))
  .handler(async ({ data }) => {
    const { downloadAgentFile } = await import("./managed-agent.server");
    return downloadAgentFile(data.fileId);
  });
