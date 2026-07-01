import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Guard: verify the calling user is in admin_users ────────────────────────
async function requireAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden: admin access only");
}

// ── Metrics ──────────────────────────────────────────────────────────────────
export const getAdminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);

    // Users by subscription type
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("subscription_type");

    const tierCounts: Record<string, number> = {};
    for (const p of profiles ?? []) {
      tierCounts[p.subscription_type] = (tierCounts[p.subscription_type] ?? 0) + 1;
    }

    // Active subscriptions revenue
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("amount_cents, currency, interval, status, plan_id")
      .eq("status", "active");

    let mrrCents = 0;
    for (const s of subs ?? []) {
      const monthly = s.interval === "year" ? s.amount_cents / 12 : s.amount_cents;
      mrrCents += monthly;
    }

    // Active enterprise members
    const { data: entMembers } = await supabaseAdmin
      .from("enterprise_members")
      .select("enterprise_id, status");
    const activeEnterprise = (entMembers ?? []).filter((m) => m.status === "active").length;

    // Total usage events (word count) this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { data: usage } = await supabaseAdmin
      .from("usage_events")
      .select("word_count")
      .gte("created_at", startOfMonth.toISOString());
    const totalWordsThisMonth = (usage ?? []).reduce((a, b) => a + b.word_count, 0);

    // Recent payment events
    const { data: recentPayments } = await supabaseAdmin
      .from("payment_events")
      .select("event_type, amount_cents, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    // Total user count
    const { count: totalUsers } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });

    // New users this month
    const { count: newUsersThisMonth } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString());

    return {
      totalUsers: totalUsers ?? 0,
      newUsersThisMonth: newUsersThisMonth ?? 0,
      tierCounts,
      mrrCents,
      activeEnterprise,
      totalWordsThisMonth,
      recentPayments: recentPayments ?? [],
    };
  });

// ── All users ────────────────────────────────────────────────────────────────
export const getAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);

    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, subscription_type, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    // Get emails from auth.users via admin API
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const emailMap: Record<string, string> = {};
    for (const u of authUsers?.users ?? []) {
      emailMap[u.id] = u.email ?? "";
    }

    return (data ?? []).map((p) => ({
      id: p.id,
      email: emailMap[p.id] ?? "",
      display_name: p.display_name,
      subscription_type: p.subscription_type,
      created_at: p.created_at,
    }));
  });

// ── Enterprises ──────────────────────────────────────────────────────────────
export const getEnterprises = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("enterprises")
      .select("*, enterprise_members(id, email, full_name, status, word_allocation, paystack_reference, activated_at)")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

const EnterpriseInput = z.object({
  name: z.string().min(1),
  contact_email: z.string().email(),
  contact_name: z.string().optional(),
  word_allocation: z.number().int().positive(),
  price_usd_cents: z.number().int().min(0),
  billing_interval: z.enum(["month", "year"]),
  notes: z.string().optional(),
});

export const createEnterprise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnterpriseInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("enterprises")
      .insert({ ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateEnterprise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    EnterpriseInput.extend({ id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { id, ...rest } = data;
    const { data: row, error } = await supabaseAdmin
      .from("enterprises")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ── Enterprise members ───────────────────────────────────────────────────────
const MemberInput = z.object({
  enterprise_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().optional(),
  word_allocation: z.number().int().positive().optional(),
});

export const addEnterpriseMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("enterprise_members")
      .insert({ ...data, status: "pending" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeEnterpriseMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ member_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    await supabaseAdmin.from("enterprise_members").delete().eq("id", data.member_id);
    return { ok: true };
  });

// ── Send payment email ───────────────────────────────────────────────────────
const SendEmailInput = z.object({
  member_id: z.string().uuid(),
});

export const sendEnterprisePaymentEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendEmailInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: member, error: mErr } = await supabaseAdmin
      .from("enterprise_members")
      .select("*, enterprises(name, price_usd_cents, billing_interval, word_allocation)")
      .eq("id", data.member_id)
      .single();
    if (mErr || !member) throw new Error("Member not found");

    const enterprise = (member as any).enterprises;
    const wordAlloc = member.word_allocation ?? enterprise.word_allocation;
    const priceUsd = enterprise.price_usd_cents / 100;
    const interval = enterprise.billing_interval;

    // Build a Paystack payment link (one-off payment for custom pricing)
    const { fetchUsdToNgnRate } = await import("@/lib/products");
    const rate = await fetchUsdToNgnRate();
    const amountKobo = Math.round(priceUsd * rate) * 100;

    const { initTransaction } = await import("@/lib/paystack.server");
    const tx = await initTransaction({
      email: member.email,
      amountLowestUnit: amountKobo,
      currency: "NGN",
      callbackUrl: `${process.env.VITE_APP_URL ?? "https://paperstudio.ai"}/billing/success?enterprise=1`,
      metadata: {
        enterprise_member_id: member.id,
        enterprise_name: enterprise.name,
        custom_fields: [
          { display_name: "Plan", variable_name: "plan", value: `Enterprise — ${enterprise.name}` },
        ],
      },
    });

    // Store reference so we can track payment
    await supabaseAdmin
      .from("enterprise_members")
      .update({ paystack_reference: tx.reference, status: "emailed", updated_at: new Date().toISOString() })
      .eq("id", data.member_id);

    // Send email via Resend
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "Paperstudio <onboarding@resend.dev>",
      to: member.email,
      subject: `Your Paperstudio Enterprise Access — ${enterprise.name}`,
      html: `
        <div style="font-family: 'Times New Roman', serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #fff; color: #111;">
          <h2 style="font-size: 20px; margin-bottom: 8px;">Welcome to Paperstudio Enterprise</h2>
          <p>Hi ${member.full_name ?? member.email},</p>
          <p>Your enterprise account has been set up under <strong>${enterprise.name}</strong>.</p>
          <table style="width:100%; border-collapse: collapse; margin: 24px 0;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Word allocation</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align:right;"><strong>${wordAlloc.toLocaleString()} words / month</strong></td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Billing</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align:right;"><strong>$${priceUsd.toFixed(2)} / ${interval}</strong></td></tr>
          </table>
          <p>Please complete your payment to activate your account:</p>
          <a href="${tx.authorization_url}" style="display: inline-block; background: #111; color: #fff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; letter-spacing: 1px; margin: 8px 0;">PAY NOW</a>
          <p style="margin-top: 32px; font-size: 12px; color: #888;">Once payment is confirmed, your account will be activated and you can sign in at <a href="https://paperstudio.ai">paperstudio.ai</a>.<br>Questions? Reply to this email or contact us at xeros.opinion@gmail.com</p>
        </div>
      `,
    });

    return { ok: true, authorization_url: tx.authorization_url };
  });

// ── Activate enterprise member ───────────────────────────────────────────────
const ActivateInput = z.object({
  member_id: z.string().uuid(),
});

export const activateEnterpriseMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ActivateInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: member, error: mErr } = await supabaseAdmin
      .from("enterprise_members")
      .select("*, enterprises(word_allocation)")
      .eq("id", data.member_id)
      .single();
    if (mErr || !member) throw new Error("Member not found");

    // Create or find auth user for this email
    let userId: string;
    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existing = authList?.users?.find((u) => u.email === member.email);

    if (existing) {
      userId = existing.id;
    } else {
      // Create a new user with a temporary password — they'll reset via email
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: member.email,
        email_confirm: true,
        user_metadata: { full_name: member.full_name },
      });
      if (createErr || !newUser?.user) throw new Error("Failed to create user: " + createErr?.message);
      userId = newUser.user.id;
    }

    const wordAlloc = member.word_allocation ?? (member as any).enterprises.word_allocation;

    // Link member record to auth user
    await supabaseAdmin
      .from("enterprise_members")
      .update({
        user_id: userId,
        status: "active",
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.member_id);

    // Upsert profile with enterprise subscription type
    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      subscription_type: "enterprise",
      enterprise_member_id: data.member_id,
      updated_at: new Date().toISOString(),
    });

    // Send a "your account is ready" email + password reset link
    const { data: resetLink } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: member.email,
    });

    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Paperstudio <onboarding@resend.dev>",
      to: member.email,
      subject: "Your Paperstudio Enterprise account is active",
      html: `
        <div style="font-family: 'Times New Roman', serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #fff; color: #111;">
          <h2 style="font-size: 20px; margin-bottom: 8px;">Your account is ready</h2>
          <p>Hi ${member.full_name ?? member.email},</p>
          <p>Your Paperstudio Enterprise account has been activated with <strong>${wordAlloc.toLocaleString()} words / month</strong>.</p>
          ${resetLink?.properties?.action_link ? `<p>Set your password to sign in:</p><a href="${resetLink.properties.action_link}" style="display: inline-block; background: #111; color: #fff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; letter-spacing: 1px; margin: 8px 0;">SET PASSWORD &amp; SIGN IN</a>` : `<p>Sign in at <a href="https://paperstudio.ai">paperstudio.ai</a> using your email.</p>`}
          <p style="margin-top: 32px; font-size: 12px; color: #888;">Questions? xeros.opinion@gmail.com</p>
        </div>
      `,
    });

    return { ok: true, userId };
  });

// ── Enterprise requests ──────────────────────────────────────────────────────
export const getEnterpriseRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("enterprise_requests")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const updateRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["new", "reviewed", "converted"]) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    await supabaseAdmin.from("enterprise_requests").update({ status: data.status }).eq("id", data.id);
    return { ok: true };
  });

// ── Enterprise request (public, unauthenticated) ─────────────────────────────
export const submitEnterpriseRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      full_name: z.string().min(1),
      email: z.string().email(),
      company: z.string().optional(),
      team_size: z.string().optional(),
      use_case: z.string().optional(),
      message: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("enterprise_requests").insert(data);
    if (error) throw new Error(error.message);

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL ?? "xeros.opinion@gmail.com";
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Paperstudio <onboarding@resend.dev>",
        to: adminEmail,
        subject: `New enterprise request from ${data.full_name} (${data.company ?? "no company"})`,
        html: `<pre style="font-family:monospace;font-size:13px">${JSON.stringify(data, null, 2)}</pre>`,
      });
    } catch {}

    return { ok: true };
  });
