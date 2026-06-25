import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ExtractInput = z.object({ name: z.string().max(200), data: z.string() });

/**
 * Extracts text from a single uploaded file. Called once per file from the client so a batch
 * of large uploads never has to ride in one oversized request body — each file's base64 payload
 * travels alone.
 */
export const extractDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExtractInput.parse(d))
  .handler(async ({ data }) => {
    const { extractText } = await import("./interviews.functions");
    const { extractWithSandbox } = await import("./sandbox-extract.server");
    const text = (await extractWithSandbox(data.data, data.name)) ?? (await extractText(data.data, data.name));
    return { text };
  });
