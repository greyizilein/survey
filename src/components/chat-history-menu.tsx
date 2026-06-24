import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { History, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listChatConversations, deleteChatConversation } from "@/lib/chat-history.functions";

type ConversationSummary = { id: string; title: string; created_at: string; updated_at: string };

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
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const listFn = useServerFn(listChatConversations);
  const deleteFn = useServerFn(deleteChatConversation);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const { conversations: rows } = await listFn({ data: { tool } });
      setConversations(rows);
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
            conversations.map((c) => (
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
                  <p className="text-[11px] text-muted-foreground">{relativeTime(c.updated_at)}</p>
                </div>
                <button
                  onClick={(e) => handleDelete(c.id, e)}
                  className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  title="Delete chat"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
