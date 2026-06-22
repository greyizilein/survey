-- Richer persona fields for higher-quality, in-character survey answers.
-- life_situation: one concrete sentence grounding the persona's daily reality.
-- key_concerns: a few things the persona actively worries about.
-- voice_sample: one sentence written exactly how the persona speaks.
ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS life_situation TEXT;
ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS key_concerns TEXT[];
ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS voice_sample TEXT;
