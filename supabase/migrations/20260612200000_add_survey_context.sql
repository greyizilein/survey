-- Store extra background material (e.g. report chapters) uploaded alongside an interview guide,
-- so it can ground generated answers without being treated as guide questions itself.
ALTER TABLE public.surveys ADD COLUMN IF NOT EXISTS background_context TEXT;
