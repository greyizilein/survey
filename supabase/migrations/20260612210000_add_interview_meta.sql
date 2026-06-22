-- Interview metadata: who is conducting the interview and their affiliation.
-- Either filled in by the user, or auto-detected from the uploaded guide during parsing.
ALTER TABLE public.surveys ADD COLUMN IF NOT EXISTS interviewer_name TEXT;
ALTER TABLE public.surveys ADD COLUMN IF NOT EXISTS interviewer_affiliation TEXT;
