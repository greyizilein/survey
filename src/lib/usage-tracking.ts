/**
 * Client-side usage tracking helper.
 * Call logWordUsage() after any feature that generates words.
 * Call checkWordLimit() before a generation to warn/block.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Free tier: 3,000 words lifetime (never resets).
 * Paid tiers: per-output word limits (reset monthly).
 */
export const FREE_LIFETIME_LIMIT = 3_000;

export const PLAN_MONTHLY_LIMITS: Record<string, number> = {
  free: FREE_LIFETIME_LIMIT,
  starter: 10_000,
  pro: 20_000,
  max: 50_000,
  enterprise: Infinity,
};

/**
 * Which features each plan can access.
 * free     — Writer only
 * starter  — Writer, Formatting, Presentations (3/mo), Survey autofill (5/mo)
 * pro      — + Smart Prompt, Interview Studio, Persona Studio, Presentations (15/mo), Survey (25/mo)
 * max      — Everything including Agent (unlimited)
 * enterprise — Everything
 */
export const PLAN_FEATURES: Record<string, string[]> = {
  free:       ["writer"],
  starter:    ["writer", "formatting", "presentations", "survey"],
  pro:        ["writer", "formatting", "presentations", "survey", "interviews", "persona"],
  max:        ["writer", "formatting", "presentations", "survey", "interviews", "persona", "agent"],
  enterprise: ["writer", "formatting", "presentations", "survey", "interviews", "persona", "agent"],
};

/**
 * Server-side quota + feature check. Call at the top of every stream endpoint.
 * - Free users: counted against a lifetime total (no reset).
 * - Paid users: counted against a monthly total (resets each month).
 */
export async function checkQuota(
  adminClient: any,
  userId: string,
  feature?: string,
): Promise<{ allowed: boolean; reason?: "quota_exceeded" | "feature_not_available"; subscriptionType: string; wordsUsed: number; limit: number; remaining: number }> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("subscription_type, enterprise_member_id")
    .eq("id", userId)
    .single();

  const subscriptionType: string = profile?.subscription_type ?? "free";

  // Feature gate check
  if (feature) {
    const allowed = PLAN_FEATURES[subscriptionType]?.includes(feature) ?? false;
    if (!allowed) {
      return { allowed: false, reason: "feature_not_available", subscriptionType, wordsUsed: 0, limit: 0, remaining: 0 };
    }
  }

  // For free users count ALL-TIME usage (lifetime limit)
  // For paid users count only this month's usage
  let query = adminClient
    .from("usage_events")
    .select("word_count")
    .eq("user_id", userId);

  if (subscriptionType !== "free") {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    query = query.gte("created_at", startOfMonth.toISOString());
  }

  const { data: events } = await query;
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
    limit = PLAN_MONTHLY_LIMITS[subscriptionType] ?? FREE_LIFETIME_LIMIT;
  }

  const remaining = Math.max(0, limit - wordsUsed);
  return { allowed: wordsUsed < limit, reason: wordsUsed >= limit ? "quota_exceeded" : undefined, subscriptionType, wordsUsed, limit, remaining };
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

    // Free users: lifetime total. Paid users: this month's total.
    let eventsQuery = supabaseAdmin
      .from("usage_events")
      .select("word_count")
      .eq("user_id", context.userId);

    if (subscriptionType !== "free") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      eventsQuery = eventsQuery.gte("created_at", startOfMonth.toISOString());
    }

    const { data: events } = await eventsQuery;

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
