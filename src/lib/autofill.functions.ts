import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FillInput = z.object({
  url: z.string().url(),
  answers: z.array(z.unknown()).min(1),
});

export const isAutofillServiceConfigured = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ configured: Boolean(process.env.AUTOFILL_SERVICE_URL) }));

export const autoFillForm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FillInput.parse(d))
  .handler(async ({ data }) => {
    const base = process.env.AUTOFILL_SERVICE_URL;
    if (!base) throw new Error("Automation service not configured");

    const res = await fetch(`${base.replace(/\/$/, "")}/fill`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.AUTOFILL_API_TOKEN ? { authorization: `Bearer ${process.env.AUTOFILL_API_TOKEN}` } : {}),
      },
      body: JSON.stringify({ url: data.url, answers: data.answers }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Automation service error (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<{ filled: number; submitted: boolean; pages: number }>;
  });
