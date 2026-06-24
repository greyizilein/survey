ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS background_context TEXT,
  ADD COLUMN IF NOT EXISTS interviewer_name TEXT,
  ADD COLUMN IF NOT EXISTS interviewer_affiliation TEXT;