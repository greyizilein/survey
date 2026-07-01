/**
 * Paystack REST helpers. Server-only.
 * Docs: https://paystack.com/docs/api
 */

const PAYSTACK_BASE = "https://api.paystack.co";

function secret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");
  return key;
}

async function paystackFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "message" in json &&
        String((json as { message: unknown }).message)) ||
      `Paystack ${res.status}`;
    throw new Error(`Paystack ${res.status}: ${message}`);
  }
  return json as T;
}

export type PaystackPlan = {
  id: number;
  plan_code: string;
  name: string;
  amount: number;
  interval: string;
  currency: string;
};

export type PaystackListPlansResponse = {
  status: boolean;
  data: PaystackPlan[];
};

export type PaystackCreatePlanResponse = {
  status: boolean;
  data: PaystackPlan;
};

export type PaystackInitResponse = {
  status: boolean;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

/** Idempotent: reuse plan by name if it already exists. */
export async function ensurePlan(opts: {
  name: string;
  amountLowestUnit: number; // kobo for NGN, cents for USD
  interval: "monthly" | "annually";
  currency: string; // "USD" | "NGN" | ...
}): Promise<PaystackPlan> {
  const list = await paystackFetch<PaystackListPlansResponse>(
    `/plan?perPage=200&status=active`,
  );
  const existing = list.data?.find(
    (p) =>
      p.name === opts.name &&
      p.amount === opts.amountLowestUnit &&
      p.interval === opts.interval &&
      p.currency === opts.currency,
  );
  if (existing) return existing;

  const created = await paystackFetch<PaystackCreatePlanResponse>(`/plan`, {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      amount: opts.amountLowestUnit,
      interval: opts.interval,
      currency: opts.currency,
    }),
  });
  return created.data;
}

export async function initTransaction(opts: {
  email: string;
  amountLowestUnit: number;
  planCode?: string;
  currency: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  reference?: string;
}): Promise<PaystackInitResponse["data"]> {
  const body: Record<string, unknown> = {
    email: opts.email,
    amount: opts.amountLowestUnit,
    currency: opts.currency,
    callback_url: opts.callbackUrl,
  };
  if (opts.planCode) body.plan = opts.planCode;
  if (opts.metadata) body.metadata = opts.metadata;
  if (opts.reference) body.reference = opts.reference;

  const res = await paystackFetch<PaystackInitResponse>(
    `/transaction/initialize`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return res.data;
}

export async function verifyTransaction(reference: string) {
  return paystackFetch<{ status: boolean; data: Record<string, unknown> }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
}

export function verifyWebhookSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  // Paystack signs with HMAC-SHA512 of the raw body using the secret key
  // We import crypto lazily to keep this file worker-safe.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac, timingSafeEqual } = require("crypto") as typeof import("crypto");
  const expected = createHmac("sha512", secret()).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
