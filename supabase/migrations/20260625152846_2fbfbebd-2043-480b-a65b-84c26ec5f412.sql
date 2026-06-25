CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('analyze', 'presentations', 'agent')),
  title TEXT NOT NULL DEFAULT 'New chat',
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_conversations_user_tool_idx ON public.chat_conversations(user_id, tool, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own chat conversations" ON public.chat_conversations;
CREATE POLICY "Users manage own chat conversations" ON public.chat_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS background_context TEXT,
  ADD COLUMN IF NOT EXISTS interviewer_name TEXT,
  ADD COLUMN IF NOT EXISTS interviewer_affiliation TEXT;