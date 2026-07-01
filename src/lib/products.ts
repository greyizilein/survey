export type BillingInterval = "month" | "year";

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  // Stripe price IDs — set after creating prices in the Stripe dashboard
  stripePriceMonthly?: string;
  stripePriceYearly?: string;
  wordCount: string;
  models: string;
  features: string[];
  /** Highlighted as the recommended plan */
  recommended?: boolean;
  /** Enterprise plan — no price, contact admin */
  enterprise?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For individuals getting started with AI writing.",
    monthlyPriceCents: 2500,
    yearlyPriceCents: 24000, // $240/yr — 2 months free
    wordCount: "10,000 words / output",
    models: "Fast + limited Pro model",
    features: [
      "10,000 words per output",
      "Fast model (unlimited)",
      "Limited Pro model (5 req/day)",
      "Writer — AI-assisted documents",
      "Survey autofill (5/mo)",
      "Presentations (3/mo)",
      "Formatting exports (5/mo)",
      "3 file uploads per session",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For researchers and professional writers.",
    monthlyPriceCents: 4500,
    yearlyPriceCents: 43200, // $432/yr — 2 months free
    wordCount: "20,000 words / output",
    models: "Fast + full Pro model",
    recommended: true,
    features: [
      "20,000 words per output",
      "Fast model (unlimited)",
      "Full Pro model (unlimited)",
      "Writer — AI-assisted documents",
      "Smart Prompt builder",
      "Interview Studio",
      "Persona Studio",
      "Survey autofill (25/mo)",
      "Presentations (15/mo)",
      "Formatting exports (20/mo)",
      "Projects & Folders",
      "8 file uploads per session",
      "Priority email support",
    ],
  },
  {
    id: "max",
    name: "Max",
    tagline: "For power users, dissertations, and heavy output.",
    monthlyPriceCents: 9000,
    yearlyPriceCents: 86400, // $864/yr — 2 months free
    wordCount: "50,000 words / output",
    models: "Fast + Pro + Max model",
    features: [
      "50,000 words per output",
      "Fast model (unlimited)",
      "Full Pro model (unlimited)",
      "Max model (unlimited)",
      "Writer — AI-assisted documents",
      "Smart Prompt builder",
      "Interview Studio",
      "Persona Studio",
      "Agent (autonomous task runner)",
      "Survey autofill (unlimited)",
      "Presentations (unlimited)",
      "Formatting exports (unlimited)",
      "Projects & Folders",
      "Unlimited file uploads",
      "Priority support + live chat",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom limits, dedicated support, and team management for organisations.",
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    wordCount: "Custom",
    models: "All models",
    enterprise: true,
    features: [
      "Custom word count limits",
      "All models + priority access",
      "Dedicated account manager",
      "Team seats & centralised billing",
      "Custom integrations & API access",
      "SLA & uptime guarantees",
      "SSO / SAML login",
      "Compliance & data residency options",
    ],
  },
];

export function formatPrice(cents: number, interval: BillingInterval): string {
  const dollars = cents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export function annualMonthlyRate(yearlyPriceCents: number): string {
  const perMonth = yearlyPriceCents / 100 / 12;
  return `$${perMonth % 1 === 0 ? perMonth.toFixed(0) : perMonth.toFixed(2)}`;
}

/** Format a USD cent amount as ₦ using a live conversion rate. */
export function formatNgn(usdCents: number, usdToNgn: number): string {
  const ngn = Math.round((usdCents / 100) * usdToNgn);
  return `₦${ngn.toLocaleString("en-NG")}`;
}

export function annualMonthlyRateNgn(yearlyPriceCents: number, usdToNgn: number): string {
  const perMonth = Math.round((yearlyPriceCents / 100 / 12) * usdToNgn);
  return `₦${perMonth.toLocaleString("en-NG")}`;
}

/**
 * Fetch the live USD → NGN exchange rate.
 * Uses open.er-api.com (free, no key required, updates daily).
 * Returns a fallback of 1650 if the fetch fails.
 */
export async function fetchUsdToNgnRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 }, // cache for 1 hour (Next.js / Vite SSR compatible)
    } as RequestInit);
    if (!res.ok) throw new Error("Rate API error");
    const json = await res.json();
    const rate = json?.rates?.NGN;
    if (typeof rate === "number" && rate > 0) return rate;
    throw new Error("No NGN rate in response");
  } catch {
    return 1650; // sensible fallback if API is unreachable
  }
}
