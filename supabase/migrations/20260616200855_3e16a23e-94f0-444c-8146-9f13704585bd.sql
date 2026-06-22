ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS life_situation TEXT;

ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS key_concerns TEXT[];

ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS voice_sample TEXT;