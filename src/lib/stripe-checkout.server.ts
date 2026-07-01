import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PLANS, fetchUsdToNgnRate } from "./products";

const CheckoutInput = z.object({
  planId: z.string(),
  interval: z.enum(["month", "year"]),
});

export const startCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CheckoutInput.parse(d))
  .handler(async ({ data }) => {
    const { stripe } = await import("./stripe.server");
    const { planId, interval } = data;

    const plan = PLANS.find((p) => p.id === planId);
    if (!plan || plan.enterprise) {
      throw new Error(`Plan "${planId}" not found or not purchasable`);
    }

    const usdCents = interval === "year" ? plan.yearlyPriceCents : plan.monthlyPriceCents;

    // Fetch live USD → NGN rate and convert to kobo (NGN × 100, Paystack's minor unit)
    const usdToNgn = await fetchUsdToNgnRate();
    const ngnAmount = Math.round((usdCents / 100) * usdToNgn); // NGN whole units
    const kobo = ngnAmount * 100; // Paystack / Stripe NGN uses kobo

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await (stripe.checkout.sessions.create as any)({
      ui_mode: "embedded",
      redirect_on_completion: "never",
      line_items: [
        {
          price_data: {
            currency: "ngn",
            product_data: {
              name: `Paperstudio ${plan.name}`,
              description: plan.tagline,
            },
            unit_amount: kobo,
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
    });

    return session.client_secret ?? null;
  });
