import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MarkReadInput = z.object({ id: z.string().uuid() });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("notifications")
      .select("id, title, body, level, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { notifications: rows ?? [] };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MarkReadInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Server-only helper for creating a notification from background/job code that isn't running inside a user request (no RLS session). */
export async function notifyUser(
  userId: string,
  notification: {
    title: string;
    body?: string;
    level?: "info" | "success" | "warning" | "error";
    link?: string;
  },
) {
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    title: notification.title,
    body: notification.body ?? null,
    level: notification.level ?? "info",
    link: notification.link ?? null,
  });
  if (error) console.error("[notifications] failed to create notification:", error);
}
