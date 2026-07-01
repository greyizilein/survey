-- ── Enterprise accounts ─────────────────────────────────────────────────────
CREATE TABLE public.enterprises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text NOT NULL,
  contact_name text,
  -- monthly word allocation for the whole account
  word_allocation integer NOT NULL DEFAULT 100000,
  -- custom monthly price in USD cents
  price_usd_cents integer NOT NULL DEFAULT 0,
  -- billing interval: 'month' | 'year'
  billing_interval text NOT NULL DEFAULT 'month',
  -- 'pending' | 'emailed' | 'active' | 'inactive'
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.enterprises TO service_role;
ALTER TABLE public.enterprises ENABLE ROW LEVEL SECURITY;
-- Only accessible via service_role (admin functions); no user-facing RLS policy

-- ── Enterprise members ───────────────────────────────────────────────────────
CREATE TABLE public.enterprise_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE CASCADE,
  -- nullable until account is created via invite
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  -- per-member word allocation override (NULL = inherit from enterprise)
  word_allocation integer,
  -- 'pending' | 'emailed' | 'active' | 'inactive'
  status text NOT NULL DEFAULT 'pending',
  -- Paystack payment reference set when email is sent
  paystack_reference text,
  -- when admin activated this member
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(enterprise_id, email)
);
CREATE INDEX enterprise_members_enterprise_idx ON public.enterprise_members(enterprise_id);
CREATE INDEX enterprise_members_user_idx ON public.enterprise_members(user_id);
CREATE INDEX enterprise_members_email_idx ON public.enterprise_members(email);
GRANT ALL ON public.enterprise_members TO service_role;
ALTER TABLE public.enterprise_members ENABLE ROW LEVEL SECURITY;

-- Members can read their own row
CREATE POLICY "Enterprise members view own row"
  ON public.enterprise_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ── Enterprise requests (from pricing page contact form) ─────────────────────
CREATE TABLE public.enterprise_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  company text,
  team_size text,
  use_case text,
  message text,
  -- 'new' | 'reviewed' | 'converted'
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.enterprise_requests TO service_role;
-- anonymous insert allowed for the contact form
ALTER TABLE public.enterprise_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit enterprise request"
  ON public.enterprise_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── Admin users (email whitelist for /admin access) ──────────────────────────
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
-- Only service_role can touch this table

-- ── Usage events (word tracking per user per feature) ────────────────────────
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL, -- 'writer' | 'agent' | 'formatting' | 'presentations' | 'survey'
  word_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_user_idx ON public.usage_events(user_id);
CREATE INDEX usage_events_created_idx ON public.usage_events(created_at);
GRANT INSERT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own usage" ON public.usage_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users view own usage" ON public.usage_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ── Extend profiles with subscription + enterprise context ───────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_type text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS enterprise_member_id uuid REFERENCES public.enterprise_members(id) ON DELETE SET NULL;

-- Helper view: monthly word usage per user (current calendar month)
CREATE OR REPLACE VIEW public.user_monthly_usage AS
  SELECT
    user_id,
    date_trunc('month', now()) AS month,
    SUM(word_count) AS words_used
  FROM public.usage_events
  WHERE created_at >= date_trunc('month', now())
  GROUP BY user_id;

GRANT SELECT ON public.user_monthly_usage TO authenticated, service_role;
