import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MarkReadInput = z.object({ id: z.string().uuid() });

const CreateInput = z.object({
  title: z.string().max(200),
  body: z.string().max(2000).optional(),
  level: z.enum(["info", "success", "warning", "error"]).optional(),
  link: z.string().max(200).optional(),
});

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

/** Client-callable: lets a page report completion of a job it just ran/awaited itself (e.g. a batch of transcript generations finishing). */
export const createNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("notifications").insert({
      user_id: context.userId,
      title: data.title,
      body: data.body ?? null,
      level: data.level ?? "info",
      link: data.link ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
