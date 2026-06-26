import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UpdateProfileInput = z.object({
  display_name: z.string().max(120).optional(),
  avatar_url: z.string().url().max(500).or(z.literal("")).optional(),
});

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile, error } = await context.supabase
      .from("profiles")
      .select("display_name, avatar_url, created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const email = (context.claims.email as string | undefined) ?? null;
    return {
      email,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      created_at: profile?.created_at ?? null,
    };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateProfileInput.parse(d))
  .handler(async ({ context, data }) => {
    const patch: { display_name?: string; avatar_url?: string | null; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (data.display_name !== undefined) patch.display_name = data.display_name.trim();
    if (data.avatar_url !== undefined) patch.avatar_url = data.avatar_url.trim() || null;

    // Upsert so a profile row is created if the signup trigger never ran.
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...patch }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Permanently deletes the user's auth account. Every app table cascades from
 * auth.users (ON DELETE CASCADE), so this wipes all of their data too.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
