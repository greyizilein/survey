CREATE TABLE public.interview_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  interviewer_name TEXT NOT NULL,
  interview_mode TEXT NOT NULL DEFAULT 'teams',
  date_start DATE,
  date_end DATE,
  context_summary TEXT,
  brief TEXT,
  naming_context TEXT,
  guide_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  respondent_count INT NOT NULL DEFAULT 0,
  anonymize BOOLEAN NOT NULL DEFAULT false,
  depth TEXT NOT NULL DEFAULT 'standard',
  source_excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interview_studies_user_idx ON public.interview_studies(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_studies TO authenticated;
GRANT ALL ON public.interview_studies TO service_role;
ALTER TABLE public.interview_studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview studies" ON public.interview_studies
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.interview_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES public.interview_studies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordinal INT NOT NULL DEFAULT 0,
  participant_label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  persona JSONB NOT NULL DEFAULT '{}'::jsonb,
  interview_date TIMESTAMPTZ,
  turns JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interview_participants_study_idx ON public.interview_participants(study_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_participants TO authenticated;
GRANT ALL ON public.interview_participants TO service_role;
ALTER TABLE public.interview_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview participants" ON public.interview_participants
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);