-- Populations: large reusable groups of personas representing a research population
CREATE TABLE public.populations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brief TEXT NOT NULL,
  target_size INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX populations_user_idx ON public.populations(user_id);
ALTER TABLE public.populations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own populations" ON public.populations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.populations TO authenticated;
GRANT ALL ON public.populations TO service_role;

ALTER TABLE public.personas ADD COLUMN population_id UUID REFERENCES public.populations(id) ON DELETE CASCADE;
CREATE INDEX personas_population_idx ON public.personas(population_id);
