import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";

const search = z.object({
  reference: z.string().optional(),
  trxref: z.string().optional(),
});

export const Route = createFileRoute("/billing/success")({
  head: () => ({
    meta: [
      { title: "Payment complete — Paperstudio" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s) => search.parse(s),
  component: BillingSuccess,
});

function BillingSuccess() {
  const { reference } = useSearch({ from: "/billing/success" });
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full border-2 border-foreground hard-shadow bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto size-14 text-accent" />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          Payment complete
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your subscription is being activated. You'll get a confirmation email
          shortly and full access should appear within a minute.
        </p>
        {reference && (
          <p className="mt-4 text-[11px] font-mono text-muted-foreground">
            Ref: {reference}
          </p>
        )}
        <Link
          to="/app/dashboard"
          className="mt-6 inline-block border-2 border-foreground bg-foreground px-6 py-3 text-xs font-bold uppercase tracking-widest text-background hard-shadow-sm hard-shadow-hover"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
