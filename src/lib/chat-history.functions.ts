import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const ChatTool = z.enum(["analyze", "presentations", "agent"]);

const ListInput = z.object({ tool: ChatTool, folderId: z.string().uuid().optional() });
const GetInput = z.object({ id: z.string().uuid() });
const SaveInput = z.object({
  id: z.string().uuid().optional(),
  tool: ChatTool,
  title: z.string().max(200).optional(),
  state: z.record(z.string(), z.unknown()),
  agentSessionId: z.string().max(200).optional(),
  folderId: z.string().uuid().nullable().optional(),
});
const DeleteInput = z.object({ id: z.string().uuid() });
const RenameInput = z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) });

export const listChatConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ context, data }) => {
    let query = context.supabase
      .from("chat_conversations")
      .select("id, title, created_at, updated_at, folder_id")
      .eq("tool", data.tool);
    if (data.folderId) query = query.eq("folder_id", data.folderId);
    const { data: rows, error } = await query.order("updated_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return { conversations: rows ?? [] };
  });

export const getChatConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("chat_conversations")
      .select("id, tool, title, state, agent_session_id, folder_id, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Conversation not found");
    return { conversation: row };
  });

export const saveChatConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ context, data }) => {
    const title = data.title?.trim() || "New chat";
    if (data.id) {
      const patch = {
        title,
        state: data.state as Json,
        agent_session_id: data.agentSessionId,
        updated_at: new Date().toISOString(),
        // Only touch folder_id when the caller explicitly sends it, so a normal
        // autosave never clobbers an assignment made elsewhere.
        ...(data.folderId !== undefined ? { folder_id: data.folderId } : {}),
      };
      const { data: row, error } = await context.supabase
        .from("chat_conversations")
        .update(patch)
        .eq("id", data.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Conversation not found");
      return { id: row.id };
    }

    const { data: row, error } = await context.supabase
      .from("chat_conversations")
      .insert({
        user_id: context.userId,
        tool: data.tool,
        title,
        state: data.state as Json,
        agent_session_id: data.agentSessionId,
        folder_id: data.folderId ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const renameChatConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RenameInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("chat_conversations")
      .update({ title: data.title.trim(), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChatConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("chat_conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
