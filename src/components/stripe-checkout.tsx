"use client";

import { useCallback, useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { X } from "lucide-react";
import { startCheckoutSession } from "@/lib/stripe-checkout.server";
import type { BillingInterval } from "@/lib/products";

// STRIPE_PUBLISHABLE_KEY is injected by Lovable as VITE_STRIPE_PUBLISHABLE_KEY at build time,
// and is also available as the NEXT_PUBLIC_ variant from the Stripe integration env vars.
const STRIPE_PK =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : "") ||
  "";

const stripePromise = loadStripe(STRIPE_PK);

interface CheckoutModalProps {
  planId: string;
  planName: string;
  interval: BillingInterval;
  onClose: () => void;
}

export function CheckoutModal({ planId, planName, interval, onClose }: CheckoutModalProps) {
  const fetchClientSecret = useCallback(
    () =>
      startCheckoutSession({ data: { planId, interval } }).then((secret) => secret ?? ""),
    [planId, interval],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-2xl bg-background border-2 border-foreground hard-shadow max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b-2 border-border px-5 py-3.5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Subscribe
            </p>
            <p className="text-base font-bold text-foreground">
              Paperstudio {planName} — {interval === "year" ? "Annual" : "Monthly"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center size-8 border-2 border-border hover:bg-muted transition-colors"
            aria-label="Close checkout"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{ fetchClientSecret }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}

interface CheckoutButtonProps {
  planId: string;
  planName: string;
  interval: BillingInterval;
  className?: string;
  children: React.ReactNode;
}

export function CheckoutButton({
  planId,
  planName,
  interval,
  className,
  children,
}: CheckoutButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && (
        <CheckoutModal
          planId={planId}
          planName={planName}
          interval={interval}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
