import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { createPaystackCheckout } from "@/lib/paystack.functions";
import type { BillingInterval } from "@/lib/products";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  planId: string;
  planName: string;
  interval: BillingInterval;
  className?: string;
  children: React.ReactNode;
}

export function PaystackCheckoutButton({
  planId,
  interval,
  className,
  children,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const startCheckout = useServerFn(createPaystackCheckout);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate({ to: "/auth" });
        return;
      }
      const res = await startCheckout({
        data: {
          planId,
          interval,
          origin: window.location.origin,
        },
      });
      window.location.href = res.authorization_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        className={className}
      >
        {loading ? "Redirecting…" : children}
      </button>
      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}
    </>
  );
}
