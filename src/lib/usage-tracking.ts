/**
 * Client-side usage tracking helper.
 * Call logWordUsage() after any feature that generates words.
 * Call checkWordLimit() before a generation to warn/block.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PLAN_MONTHLY_LIMITS: Record<string, number> = {
  free: 3_000,
  starter: 10_000,
  pro: 20_000,
  max: 50_000,
  enterprise: Infinity, // per-member allocation stored in enterprise_members
};

/**
 * Server-side quota check — call this at the top of every stream endpoint,
 * right after auth succeeds, passing the supabaseAdmin client and userId.
 * Returns { allowed: false } when the user has hit their monthly word limit.
 */
export async function checkQuota(
  adminClient: any,
  userId: string,
): Promise<{ allowed: boolean; subscriptionType: string; wordsUsed: number; limit: number; remaining: number }> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("subscription_type, enterprise_member_id")
    .eq("id", userId)
    .single();

  const subscriptionType: string = profile?.subscription_type ?? "free";

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: events } = await adminClient
    .from("usage_events")
    .select("word_count")
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  const wordsUsed: number = (events ?? []).reduce((a: number, b: { word_count: number }) => a + b.word_count, 0);

  let limit: number;
  if (subscriptionType === "enterprise" && profile?.enterprise_member_id) {
    const { data: member } = await adminClient
      .from("enterprise_members")
      .select("word_allocation, enterprises(word_allocation)")
      .eq("id", profile.enterprise_member_id)
      .single();
    limit = member?.word_allocation ?? (member as any)?.enterprises?.word_allocation ?? 100_000;
  } else {
    limit = PLAN_MONTHLY_LIMITS[subscriptionType] ?? PLAN_MONTHLY_LIMITS.free;
  }

  const remaining = Math.max(0, limit - wordsUsed);
  return { allowed: wordsUsed < limit, subscriptionType, wordsUsed, limit, remaining };
}

// ── Log word usage ────────────────────────────────────────────────────────────
export const logWordUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      feature: z.enum(["writer", "agent", "formatting", "presentations", "survey"]),
      word_count: z.number().int().positive(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await supabaseAdmin.from("usage_events").insert({
      user_id: context.userId,
      feature: data.feature,
      word_count: data.word_count,
    });
    return { ok: true };
  });

// ── Check usage / quota ───────────────────────────────────────────────────────
export const getWordUsageStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Get profile + subscription type
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_type, enterprise_member_id")
      .eq("id", context.userId)
      .single();

    const subscriptionType = profile?.subscription_type ?? "free";

    // Get this month's total usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: events } = await supabaseAdmin
      .from("usage_events")
      .select("word_count")
      .eq("user_id", context.userId)
      .gte("created_at", startOfMonth.toISOString());

    const wordsUsed = (events ?? []).reduce((a, b) => a + b.word_count, 0);

    // Determine limit
    let limit: number;
    if (subscriptionType === "enterprise" && profile?.enterprise_member_id) {
      const { data: member } = await supabaseAdmin
        .from("enterprise_members")
        .select("word_allocation, enterprises(word_allocation)")
        .eq("id", profile.enterprise_member_id)
        .single();
      limit = member?.word_allocation ?? (member as any)?.enterprises?.word_allocation ?? 100_000;
    } else {
      limit = PLAN_MONTHLY_LIMITS[subscriptionType] ?? PLAN_MONTHLY_LIMITS.free;
    }

    const remaining = Math.max(0, limit - wordsUsed);
    const pct = limit === Infinity ? 0 : Math.min(100, Math.round((wordsUsed / limit) * 100));

    return {
      subscriptionType,
      wordsUsed,
      limit,
      remaining,
      pct,
      exceeded: wordsUsed >= limit,
    };
  });
