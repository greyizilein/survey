import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, Plus, MessageSquareText, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listFolders, createFolder } from "@/lib/folders.functions";

export const Route = createFileRoute("/_authenticated/app/folders/")({
  head: () => ({ meta: [{ title: "Folders · Paperstudio" }] }),
  component: FoldersIndex,
});

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function FoldersIndex() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listFolders);
  const createFn = useServerFn(createFolder);
  const q = useQuery({ queryKey: ["folders"], queryFn: () => listFn() });

  async function create() {
    try {
      const { id } = await createFn({ data: {} });
      qc.invalidateQueries({ queryKey: ["folders"] });
      navigate({ to: "/app/folders/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create folder");
    }
  }

  const folders = q.data?.folders ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Folder className="size-5 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Folders</h1>
              <p className="text-sm text-muted-foreground">
                Group related chats and give them shared instructions and reference files.
              </p>
            </div>
          </div>
          <Button onClick={create} className="shrink-0">
            <Plus className="size-4" /> New folder
          </Button>
        </div>

        {q.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : folders.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <Folder className="size-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">No folders yet</p>
              <p className="text-sm text-muted-foreground">
                Create a folder to keep a project's chats, instructions, and files together.
              </p>
            </div>
            <Button onClick={create} variant="outline">
              <Plus className="size-4" /> New folder
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <Link key={f.id} to="/app/folders/$id" params={{ id: f.id }}>
                <Card className="h-full p-4 transition-colors hover:border-primary/50 hover:bg-muted/30">
                  <div className="mb-3 flex items-start gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Folder className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Updated {relativeTime(f.updated_at)}
                      </p>
                    </div>
                  </div>
                  {f.instructions?.trim() && (
                    <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                      {f.instructions.trim()}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MessageSquareText className="size-3.5" /> {f.chat_count} chat
                      {f.chat_count === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="size-3.5" /> {f.file_count} file
                      {f.file_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
