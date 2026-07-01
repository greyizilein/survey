import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/paystack-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-paystack-signature");

        const { verifyWebhookSignature } = await import("@/lib/paystack.server");
        if (!verifyWebhookSignature(rawBody, signature)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          event?: string;
          data?: Record<string, unknown>;
        } = {};
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const eventType = payload.event ?? "unknown";
        const data = payload.data ?? {};
        const metadata =
          (data.metadata as Record<string, unknown> | undefined) ?? {};
        const userId =
          typeof metadata.user_id === "string" ? metadata.user_id : null;
        const planId =
          typeof metadata.plan_id === "string" ? metadata.plan_id : null;
        const interval =
          typeof metadata.interval === "string" ? metadata.interval : null;
        const reference =
          typeof data.reference === "string" ? data.reference : null;
        const amount =
          typeof data.amount === "number" ? data.amount : null;
        const currency =
          typeof data.currency === "string" ? data.currency : null;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Log every event (idempotent on reference+type)
        await supabaseAdmin.from("payment_events").insert({
          user_id: userId,
          event_type: eventType,
          reference,
          amount_cents: amount,
          currency,
          raw: payload as never,
        });

        try {
          if (eventType === "charge.success" && userId && planId && interval) {
            const customerCode =
              ((data.customer as Record<string, unknown> | undefined)
                ?.customer_code as string | undefined) ?? null;

            await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "active",
                paystack_customer_code: customerCode,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("plan_id", planId)
              .eq("interval", interval)
              .eq("status", "pending");
          }

          if (eventType === "subscription.create") {
            const subCode =
              typeof data.subscription_code === "string"
                ? data.subscription_code
                : null;
            const emailToken =
              typeof data.email_token === "string" ? data.email_token : null;
            const nextPayment =
              typeof data.next_payment_date === "string"
                ? data.next_payment_date
                : null;
            const planCode =
              ((data.plan as Record<string, unknown> | undefined)
                ?.plan_code as string | undefined) ?? null;
            const customerCode =
              ((data.customer as Record<string, unknown> | undefined)
                ?.customer_code as string | undefined) ?? null;

            if (customerCode && planCode) {
              await supabaseAdmin
                .from("subscriptions")
                .update({
                  status: "active",
                  paystack_subscription_code: subCode,
                  paystack_email_token: emailToken,
                  paystack_customer_code: customerCode,
                  current_period_end: nextPayment,
                  updated_at: new Date().toISOString(),
                })
                .eq("paystack_plan_code", planCode)
                .eq("paystack_customer_code", customerCode);
            }
          }

          if (
            eventType === "subscription.disable" ||
            eventType === "subscription.not_renew"
          ) {
            const subCode =
              typeof data.subscription_code === "string"
                ? data.subscription_code
                : null;
            if (subCode) {
              await supabaseAdmin
                .from("subscriptions")
                .update({
                  status:
                    eventType === "subscription.not_renew"
                      ? "non-renewing"
                      : "cancelled",
                  updated_at: new Date().toISOString(),
                })
                .eq("paystack_subscription_code", subCode);
            }
          }

          if (eventType === "invoice.payment_failed") {
            const subCode =
              ((data.subscription as Record<string, unknown> | undefined)
                ?.subscription_code as string | undefined) ?? null;
            if (subCode) {
              await supabaseAdmin
                .from("subscriptions")
                .update({
                  status: "attention",
                  updated_at: new Date().toISOString(),
                })
                .eq("paystack_subscription_code", subCode);
            }
          }
        } catch (err) {
          console.error("[paystack-webhook] processing error", err);
          // Still 200 so Paystack doesn't retry storm; event is logged.
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
