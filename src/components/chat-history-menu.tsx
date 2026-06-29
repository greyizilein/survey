import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  History,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Check,
  X,
  FolderInput,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  listChatConversations,
  deleteChatConversation,
  renameChatConversation,
} from "@/lib/chat-history.functions";
import { listFolders, assignChatToFolder } from "@/lib/folders.functions";

type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_id: string | null;
};
type FolderSummary = { id: string; name: string };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ChatHistoryMenu({
  tool,
  activeId,
  onSelect,
  onNew,
}: {
  tool: "analyze" | "presentations" | "agent";
  activeId: string | null;
  folderId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const listFn = useServerFn(listChatConversations);
  const deleteFn = useServerFn(deleteChatConversation);
  const renameFn = useServerFn(renameChatConversation);
  const listFoldersFn = useServerFn(listFolders);
  const assignFn = useServerFn(assignChatToFolder);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [{ conversations: rows }, { folders: folderRows }] = await Promise.all([
        listFn({ data: { tool } }),
        listFoldersFn(),
      ]);
      setConversations(rows);
      setFolders(folderRows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await deleteFn({ data: { id } });
    if (id === activeId) onNew();
  }

  function startRename(c: ConversationSummary, e: React.MouseEvent) {
    e.stopPropagation();
    setRenamingId(c.id);
    setRenameValue(c.title);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  async function commitRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    // Optimistically update local list; roll back to the original title on failure.
    const previous = conversations.find((c) => c.id === id)?.title ?? title;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    try {
      await renameFn({ data: { id, title } });
    } catch {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: previous } : c)));
    }
  }

  async function moveToFolder(chatId: string, targetFolderId: string | null) {
    setConversations((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, folder_id: targetFolderId } : c)),
    );
    try {
      await assignFn({ data: { chat_id: chatId, folder_id: targetFolderId } });
    } catch {
      refresh();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" title="Chat history">
          <History className="size-4 shrink-0" />
          <span className="truncate text-xs hidden sm:inline">History</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start" side="top">
        <button
          onClick={() => {
            onNew();
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm font-medium hover:bg-muted/60"
        >
          <Plus className="size-4" /> New chat
        </button>
        <div className="mt-1 max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">No past chats yet.</p>
          )}
          {!loading &&
            conversations.map((c) =>
              renamingId === c.id ? (
                <div key={c.id} className="flex items-center gap-1 rounded px-2 py-1.5">
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => commitRename(c.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Save"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Cancel"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded px-2 py-2 text-sm cursor-pointer",
                    c.id === activeId ? "bg-primary/10 font-medium" : "hover:bg-muted/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{c.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {relativeTime(c.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "hover:text-foreground",
                            c.folder_id ? "text-primary" : "text-muted-foreground",
                          )}
                          title="Move to folder"
                        >
                          {c.folder_id ? (
                            <Folder className="size-3.5" />
                          ) : (
                            <FolderInput className="size-3.5" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {folders.length === 0 && (
                          <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                        )}
                        {folders.map((f) => (
                          <DropdownMenuItem
                            key={f.id}
                            onClick={() => moveToFolder(c.id, f.id)}
                            className={cn(c.folder_id === f.id && "bg-primary/10")}
                          >
                            <Folder className="size-4" /> {f.name}
                            {c.folder_id === f.id && <Check className="ml-auto size-3.5" />}
                          </DropdownMenuItem>
                        ))}
                        {c.folder_id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => moveToFolder(c.id, null)}>
                              <X className="size-4" /> Remove from folder
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      onClick={(e) => startRename(c, e)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Rename chat"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(c.id, e)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete chat"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ),
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
