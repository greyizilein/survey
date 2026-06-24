-- Persistent, revisitable chat history for the app's chat-style tools
-- (Writing/Analyze, Presentations, the standalone Agent). One row per
-- conversation; `state` holds whatever the owning tool needs to fully
-- restore itself (messages, plus tool-specific extras like instructions
-- presets or a managed-agent session id).
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('analyze', 'presentations', 'agent')),
  title TEXT NOT NULL DEFAULT 'New chat',
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_conversations_user_tool_idx ON public.chat_conversations(user_id, tool, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own chat conversations" ON public.chat_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
