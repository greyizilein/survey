-- Folders: Claude/ChatGPT-style "projects" that group chats and carry shared
-- context (custom instructions + reference files) injected into every chat
-- inside them. Named "folders" to avoid colliding with the existing
-- survey-oriented `projects` table.
CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New folder',
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX folders_user_idx ON public.folders(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own folders" ON public.folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reference files attached to a folder. We store the *extracted text* (via the
-- existing document-extract pipeline) rather than the blob — that's all the
-- model needs, and it keeps us off blob storage.
CREATE TABLE public.folder_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX folder_files_folder_idx ON public.folder_files(folder_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folder_files TO authenticated;
GRANT ALL ON public.folder_files TO service_role;
ALTER TABLE public.folder_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own folder files" ON public.folder_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A chat optionally belongs to one folder. SET NULL on delete so removing a
-- folder leaves its chats intact (they just fall back to "unfiled").
ALTER TABLE public.chat_conversations
  ADD COLUMN folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
CREATE INDEX chat_conversations_folder_idx ON public.chat_conversations(folder_id);
