import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLANS, formatPrice, annualMonthlyRate, type BillingInterval } from "@/lib/products";
import { PaystackCheckoutButton } from "@/components/paystack-button";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Paperstudio" },
      { name: "description", content: "Simple, transparent pricing for every stage of your writing. Starter from $25/mo." },
    ],
  }),
  component: PricingPage,
});

// Feature comparison rows
const COMPARISON_ROWS: { label: string; starter: string | boolean; pro: string | boolean; max: string | boolean; enterprise: string | boolean }[] = [
  { label: "Words per output", starter: "10,000", pro: "20,000", max: "50,000", enterprise: "Custom" },
  { label: "Fast model", starter: true, pro: true, max: true, enterprise: true },
  { label: "Pro model", starter: "5 req / day", pro: true, max: true, enterprise: true },
  { label: "Max model", starter: false, pro: false, max: true, enterprise: true },
  { label: "Writer (AI documents)", starter: true, pro: true, max: true, enterprise: true },
  { label: "Smart Prompt builder", starter: false, pro: true, max: true, enterprise: true },
  { label: "Interview Studio", starter: false, pro: true, max: true, enterprise: true },
  { label: "Persona Studio", starter: false, pro: true, max: true, enterprise: true },
  { label: "Agent", starter: false, pro: false, max: true, enterprise: true },
  { label: "Survey autofill", starter: "5 / mo", pro: "25 / mo", max: "Unlimited", enterprise: "Custom" },
  { label: "Presentations", starter: "3 / mo", pro: "15 / mo", max: "Unlimited", enterprise: "Custom" },
  { label: "Formatting exports", starter: "5 / mo", pro: "20 / mo", max: "Unlimited", enterprise: "Custom" },
  { label: "Projects & Folders", starter: false, pro: true, max: true, enterprise: true },
  { label: "File uploads / session", starter: "3", pro: "8", max: "Unlimited", enterprise: "Unlimited" },
  { label: "Support", starter: "Email", pro: "Priority email", max: "Priority + live chat", enterprise: "Dedicated manager" },
  { label: "SSO / SAML", starter: false, pro: false, max: false, enterprise: true },
  { label: "Team seats", starter: false, pro: false, max: false, enterprise: true },
  { label: "SLA & uptime guarantee", starter: false, pro: false, max: false, enterprise: true },
];

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="size-4 text-accent mx-auto" aria-label="Included" />;
  if (value === false) return <span className="text-muted-foreground/40 mx-auto block text-center">—</span>;
  return <span className="text-sm text-center block">{value}</span>;
}

function PricingPage() {
  const [interval, setInterval] = useState<BillingInterval>("month");

  const nonEnterprisePlans = PLANS.filter((p) => !p.enterprise);
  const enterprisePlan = PLANS.find((p) => p.enterprise)!;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Nav */}
      <header className="flex items-center justify-between border-b-2 border-border px-6 py-4 sm:px-10">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-sm font-bold uppercase tracking-tight">Paperstudio</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/auth" className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </Link>
          <Link
            to="/auth"
            className="border-2 border-foreground bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hard-shadow-sm hard-shadow-hover"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-8 pt-16 text-center sm:px-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Pricing
        </p>
        <h1 className="mt-3 text-5xl font-extrabold tracking-tight sm:text-6xl text-balance">
          Pay once. Write forever.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg text-pretty">
          All plans include the full Paperstudio workspace. Upgrade for higher word counts, more powerful models, and advanced tools.
        </p>

        {/* Billing toggle */}
        <div className="mt-8 inline-flex items-center border-2 border-border">
          <button
            onClick={() => setInterval("month")}
            className={cn(
              "px-5 py-2 text-xs font-bold uppercase tracking-widest transition-colors",
              interval === "month"
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval("year")}
            className={cn(
              "flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase tracking-widest transition-colors",
              interval === "year"
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Annual
            <span className={cn(
              "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              interval === "year" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
            )}>
              2 months free
            </span>
          </button>
        </div>
      </section>

      {/* Plan cards */}
      <section className="mx-auto max-w-6xl px-6 pb-16 sm:px-10">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {nonEnterprisePlans.map((plan) => {
            const isRecommended = plan.recommended;
            const price = interval === "year"
              ? annualMonthlyRate(plan.yearlyPriceCents)
              : formatPrice(plan.monthlyPriceCents, interval);
            const annualTotal = formatPrice(plan.yearlyPriceCents, "year");

            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col border-2 p-6 transition-all",
                  isRecommended
                    ? "border-foreground hard-shadow bg-foreground text-background"
                    : "border-border bg-card text-foreground hard-shadow-sm",
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn(
                      "text-[11px] font-bold uppercase tracking-[0.2em]",
                      isRecommended ? "text-accent" : "text-muted-foreground"
                    )}>
                      {plan.name}
                    </p>
                    <p className={cn(
                      "mt-1 text-sm",
                      isRecommended ? "text-background/70" : "text-muted-foreground"
                    )}>
                      {plan.tagline}
                    </p>
                  </div>
                  {isRecommended && (
                    <span className="shrink-0 bg-accent text-accent-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                      Most popular
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="mt-6">
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-extrabold tracking-tight">{price}</span>
                    <span className={cn(
                      "mb-1.5 text-sm font-medium",
                      isRecommended ? "text-background/60" : "text-muted-foreground"
                    )}>
                      / mo
                    </span>
                  </div>
                  {interval === "year" && (
                    <p className={cn(
                      "mt-1 text-xs",
                      isRecommended ? "text-background/60" : "text-muted-foreground"
                    )}>
                      Billed {annualTotal} / year
                    </p>
                  )}
                </div>

                {/* Word count pill */}
                <div className={cn(
                  "mt-4 inline-flex w-fit items-center border px-3 py-1 text-xs font-bold uppercase tracking-wide",
                  isRecommended ? "border-background/30 text-background/80" : "border-border text-muted-foreground"
                )}>
                  {plan.wordCount}
                </div>

                {/* CTA */}
                <CheckoutButton
                  planId={plan.id}
                  planName={plan.name}
                  interval={interval}
                  className={cn(
                    "mt-6 w-full border-2 py-3 text-xs font-bold uppercase tracking-widest transition-all hard-shadow-hover",
                    isRecommended
                      ? "border-accent bg-accent text-accent-foreground hard-shadow-sm"
                      : "border-foreground bg-background text-foreground hard-shadow-sm hover:bg-foreground hover:text-background",
                  )}
                >
                  Get {plan.name}
                </CheckoutButton>

                {/* Features */}
                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5">
                      <Check className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        isRecommended ? "text-accent" : "text-accent-foreground"
                      )} />
                      <span className={cn(
                        "text-sm",
                        isRecommended ? "text-background/85" : "text-foreground/80"
                      )}>
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Enterprise card — full-width strip */}
        <div className="mt-5 flex flex-col gap-6 border-2 border-border bg-muted p-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Enterprise
              </p>
              <span className="border-2 border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Custom pricing
              </span>
            </div>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight">{enterprisePlan.tagline}</h3>
            <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {enterprisePlan.features.map((feat) => (
                <li key={feat} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span className="text-sm text-foreground/80">{feat}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="shrink-0">
            <a
              href="mailto:hello@paperstudio.ai?subject=Enterprise%20enquiry"
              className="flex items-center gap-2 border-2 border-foreground bg-foreground px-7 py-3.5 text-sm font-bold uppercase tracking-widest text-background hard-shadow hard-shadow-hover"
            >
              <Mail className="size-4" />
              Contact us
            </a>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="mx-auto max-w-6xl px-6 pb-24 sm:px-10">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Compare plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">Everything you get at a glance.</p>

        <div className="mt-6 overflow-x-auto border-2 border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-muted">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground w-1/3">
                  Feature
                </th>
                {["Starter", "Pro", "Max", "Enterprise"].map((name) => (
                  <th key={name} className={cn(
                    "px-4 py-3 text-center text-xs font-bold uppercase tracking-widest",
                    name === "Pro" ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {name}
                    {name === "Pro" && (
                      <span className="ml-1.5 bg-accent text-accent-foreground px-1.5 py-0.5 text-[9px] font-bold uppercase">
                        Popular
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, i) => (
                <tr
                  key={row.label}
                  className={cn(
                    "border-b border-border/50",
                    i % 2 === 0 ? "bg-background" : "bg-muted/40",
                  )}
                >
                  <td className="px-4 py-3 font-medium text-foreground/80">{row.label}</td>
                  <td className="px-4 py-3"><CellValue value={row.starter} /></td>
                  <td className="px-4 py-3 bg-accent/5"><CellValue value={row.pro} /></td>
                  <td className="px-4 py-3"><CellValue value={row.max} /></td>
                  <td className="px-4 py-3"><CellValue value={row.enterprise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t-2 border-border bg-foreground py-16 text-center text-background">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Start writing today.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-background/60">
          No lock-in. Cancel anytime. Upgrade or downgrade whenever you need.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="border-2 border-accent bg-accent px-8 py-3.5 text-sm font-bold uppercase tracking-widest text-accent-foreground hard-shadow-sm hard-shadow-hover"
            style={{ "--color-border": "oklch(0.85 0.19 126)" } as React.CSSProperties}
          >
            Get started free
          </Link>
          <a
            href="mailto:hello@paperstudio.ai?subject=Enterprise%20enquiry"
            className="border-2 border-background/30 px-8 py-3.5 text-sm font-bold uppercase tracking-widest text-background/70 hover:border-background/60 hover:text-background transition-colors"
          >
            Talk to us
          </a>
        </div>
      </section>

      {/* Minimal footer */}
      <footer className="border-t-2 border-border px-6 py-8 text-center text-xs text-muted-foreground sm:px-10">
        <div className="flex flex-wrap items-center justify-center gap-6">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <a href="mailto:hello@paperstudio.ai" className="hover:text-foreground transition-colors">hello@paperstudio.ai</a>
          <span>© {new Date().getFullYear()} Paperstudio</span>
        </div>
      </footer>
    </div>
  );
}
