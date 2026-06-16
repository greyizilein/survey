-- Qualitative Interview Studio
-- A "study" is one uploaded research context (methodology + interview guide).
-- Each study produces one full conversational transcript per simulated
-- respondent, stored as structured turns so any download format (VTT, DOCX,
-- TXT, MD, PDF) can be rendered client-side.

CREATE TABLE public.interview_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  interviewer_name TEXT NOT NULL,
  interview_mode TEXT NOT NULL DEFAULT 'teams',   -- teams | zoom | in_person
  date_start DATE,                                 -- interviews "took place" between
  date_end DATE,                                   -- these dates (spread realistically)
  context_summary TEXT,                            -- AI's understanding of the study
  brief TEXT,                                      -- optional extra notes from the user
  naming_context TEXT,                             -- cultural/professional naming guidance
  guide_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  respondent_count INT NOT NULL DEFAULT 0,
  anonymize BOOLEAN NOT NULL DEFAULT false,        -- true => participant codes (P01) as labels
  depth TEXT NOT NULL DEFAULT 'standard',          -- brief | standard | in_depth
  source_excerpt TEXT,                             -- truncated extracted text from uploads
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | generating | complete
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
  ordinal INT NOT NULL DEFAULT 0,                  -- 1..N, ordering within the study
  participant_label TEXT NOT NULL,                 -- "P01" or the display name
  display_name TEXT NOT NULL,                      -- the persona's full name
  persona JSONB NOT NULL DEFAULT '{}'::jsonb,      -- demographic + voice profile
  interview_date TIMESTAMPTZ,                      -- when this specific interview "happened"
  turns JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{speaker, role, text}]
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | done | error
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interview_participants_study_idx ON public.interview_participants(study_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_participants TO authenticated;
GRANT ALL ON public.interview_participants TO service_role;
ALTER TABLE public.interview_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview participants" ON public.interview_participants
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
