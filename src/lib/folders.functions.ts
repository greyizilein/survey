import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdInput = z.object({ id: z.string().uuid() });
const CreateInput = z.object({ name: z.string().max(120).optional() });
const RenameInput = z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) });
const InstructionsInput = z.object({ id: z.string().uuid(), instructions: z.string().max(20000) });
const AddFileInput = z.object({
  folder_id: z.string().uuid(),
  name: z.string().max(200),
  data: z.string(),
});
const AssignInput = z.object({
  chat_id: z.string().uuid(),
  folder_id: z.string().uuid().nullable(),
});

export const listFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: folders, error } = await context.supabase
      .from("folders")
      .select("id, name, instructions, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!folders?.length) return { folders: [] };

    const ids = folders.map((f) => f.id);
    const [{ data: chats }, { data: files }] = await Promise.all([
      context.supabase.from("chat_conversations").select("folder_id").in("folder_id", ids),
      context.supabase.from("folder_files").select("folder_id").in("folder_id", ids),
    ]);

    const chatCount = new Map<string, number>();
    for (const c of chats ?? [])
      if (c.folder_id) chatCount.set(c.folder_id, (chatCount.get(c.folder_id) ?? 0) + 1);
    const fileCount = new Map<string, number>();
    for (const f of files ?? []) fileCount.set(f.folder_id, (fileCount.get(f.folder_id) ?? 0) + 1);

    return {
      folders: folders.map((f) => ({
        ...f,
        chat_count: chatCount.get(f.id) ?? 0,
        file_count: fileCount.get(f.id) ?? 0,
      })),
    };
  });

export const getFolder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: folder, error } = await context.supabase
      .from("folders")
      .select("id, name, instructions, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!folder) throw new Error("Folder not found");

    const [{ data: files }, { data: chats }] = await Promise.all([
      context.supabase
        .from("folder_files")
        .select("id, name, created_at")
        .eq("folder_id", data.id)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("chat_conversations")
        .select("id, title, tool, updated_at")
        .eq("folder_id", data.id)
        .order("updated_at", { ascending: false }),
    ]);

    return { folder, files: files ?? [], chats: chats ?? [] };
  });

export const createFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("folders")
      .insert({ user_id: context.userId, name: data.name?.trim() || "New folder" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const renameFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RenameInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("folders")
      .update({ name: data.name.trim(), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateFolderInstructions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InstructionsInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("folders")
      .update({ instructions: data.instructions, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }) => {
    // chat_conversations.folder_id is ON DELETE SET NULL, so chats survive.
    const { error } = await context.supabase.from("folders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addFolderFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddFileInput.parse(d))
  .handler(async ({ context, data }) => {
    const { extractText } = await import("./interviews.functions");
    const { extractWithSandbox } = await import("./sandbox-extract.server");

    let text: string | null = null;
    try {
      text = await extractWithSandbox(data.data, data.name);
    } catch (e) {
      console.error(`[folders] sandbox extraction failed for "${data.name}", falling back:`, e);
    }
    if (text === null) text = await extractText(data.data, data.name);

    const { data: row, error } = await context.supabase
      .from("folder_files")
      .insert({
        folder_id: data.folder_id,
        user_id: context.userId,
        name: data.name,
        extracted_text: text,
      })
      .select("id, name, created_at")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase
      .from("folders")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.folder_id);

    return { file: row };
  });

export const removeFolderFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("folder_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignChatToFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AssignInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("chat_conversations")
      .update({ folder_id: data.folder_id })
      .eq("id", data.chat_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Builds the shared-context string for a folder — its custom instructions plus
 * the extracted text of every attached file — for injection into a chat's prompt.
 * Returns "" when the folder has no usable context. Capped to stay prompt-safe.
 */
export const getFolderContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: folder } = await context.supabase
      .from("folders")
      .select("name, instructions")
      .eq("id", data.id)
      .maybeSingle();
    if (!folder) return { context: "", name: null };

    const { data: files } = await context.supabase
      .from("folder_files")
      .select("name, extracted_text")
      .eq("folder_id", data.id)
      .order("created_at", { ascending: true });

    const parts: string[] = [];
    if (folder.instructions?.trim()) {
      parts.push(
        `FOLDER INSTRUCTIONS (apply to this whole conversation):\n${folder.instructions.trim()}`,
      );
    }

    const refFiles = (files ?? []).filter((f) => f.extracted_text?.trim());
    const MAX = 200_000;
    const instructionsLen = parts.join("\n\n").length;
    const filesBudget = Math.max(0, MAX - instructionsLen);
    if (refFiles.length > 0) {
      const { isTabular, truncateRows } = await import("./analyze.functions");
      const baseBudget = Math.max(2000, Math.floor(filesBudget / refFiles.length));
      const tabularCount = refFiles.filter((f) => isTabular(f.name, f.extracted_text!)).length;
      const tabularBudget = tabularCount > 0 ? Math.floor((filesBudget * 0.6) / tabularCount) : 0;
      const narrativeCount = refFiles.length - tabularCount;
      const narrativeBudget =
        narrativeCount > 0
          ? Math.max(2000, Math.floor((filesBudget * (tabularCount > 0 ? 0.4 : 1)) / narrativeCount))
          : baseBudget;

      for (const f of refFiles) {
        const text = f.extracted_text!.trim();
        const tabular = isTabular(f.name, text);
        const budget = tabular ? Math.max(baseBudget, tabularBudget) : narrativeBudget;
        const truncated =
          text.length <= budget
            ? text
            : tabular
              ? truncateRows(text, budget)
              : text.slice(0, budget) + "\n…[truncated]";
        parts.push(`FOLDER REFERENCE FILE — ${f.name}:\n${truncated}`);
      }
    }

    return { context: parts.join("\n\n"), name: folder.name };
  });
