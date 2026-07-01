import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLANS, fetchUsdToNgnRate, type BillingInterval } from "@/lib/products";

const CheckoutInput = z.object({
  planId: z.string(),
  interval: z.enum(["month", "year"]),
  origin: z.string().url(),
});

/**
 * Initialize a Paystack subscription checkout. Returns an authorization_url
 * for the browser to redirect to. Creates (or reuses) a Paystack Plan for
 * the requested tier + interval so the customer is auto-subscribed after
 * successful payment.
 */
export const createPaystackCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CheckoutInput.parse(d))
  .handler(async ({ data, context }) => {
    const plan = PLANS.find((p) => p.id === data.planId);
    if (!plan || plan.enterprise) {
      throw new Error(`Plan "${data.planId}" not purchasable`);
    }

    const { ensurePlan, initTransaction } = await import("@/lib/paystack.server");

    const interval: BillingInterval = data.interval;
    const usdCents =
      interval === "year" ? plan.yearlyPriceCents : plan.monthlyPriceCents;

    // Convert USD → NGN at live rate, then to kobo (Paystack's minor unit = NGN × 100)
    const usdToNgn = await fetchUsdToNgnRate();
    const ngnWhole = Math.round((usdCents / 100) * usdToNgn);
    const amountKobo = ngnWhole * 100;
    const currency = "NGN";

    const paystackPlan = await ensurePlan({
      name: `Paperstudio ${plan.name} — ${interval === "year" ? "Annual" : "Monthly"}`,
      amountLowestUnit: amountKobo,
      interval: interval === "year" ? "annually" : "monthly",
      currency,
    });

    const email =
      (context.claims?.email as string | undefined) ??
      `${context.userId}@users.paperstudio.dev`;

    const callbackUrl = `${data.origin.replace(/\/$/, "")}/billing/success`;

    const init = await initTransaction({
      email,
      amountLowestUnit: amountKobo,
      planCode: paystackPlan.plan_code,
      currency,
      callbackUrl,
      metadata: {
        user_id: context.userId,
        plan_id: plan.id,
        interval,
        custom_fields: [
          {
            display_name: "Plan",
            variable_name: "plan",
            value: `${plan.name} (${interval})`,
          },
        ],
      },
    });

    // Record a pending subscription row so the webhook can enrich it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("subscriptions").insert({
      user_id: context.userId,
      plan_id: plan.id,
      interval,
      status: "pending",
      paystack_plan_code: paystackPlan.plan_code,
      amount_cents: amountKobo,
      currency,
    });

    return {
      authorization_url: init.authorization_url,
      reference: init.reference,
    };
  });

export const listMySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("subscriptions")
      .select("id, plan_id, interval, status, current_period_end, amount_cents, currency, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
