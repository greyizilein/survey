import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Folder,
  Loader2,
  Upload,
  FileText,
  X,
  Trash2,
  Check,
  Pencil,
  MessageSquareText,
  Presentation,
  Bot,
  PenLine,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getFolder,
  renameFolder,
  updateFolderInstructions,
  deleteFolder,
  addFolderFile,
  removeFolderFile,
  assignChatToFolder,
} from "@/lib/folders.functions";
import { IngestBadge, ingestIconClass, type IngestStatus } from "@/components/ingest-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/folders/$id")({
  head: () => ({ meta: [{ title: "Folder · Paperstudio" }] }),
  component: FolderDetail,
});

const TOOL_META: Record<string, { label: string; icon: typeof Bot; to: string }> = {
  analyze: { label: "Writing", icon: PenLine, to: "/app/analyze" },
  presentations: { label: "Presentations", icon: Presentation, to: "/app/presentations" },
  agent: { label: "Agent", icon: Bot, to: "/app/agent" },
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FolderDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getFn = useServerFn(getFolder);
  const renameFn = useServerFn(renameFolder);
  const instructionsFn = useServerFn(updateFolderInstructions);
  const deleteFn = useServerFn(deleteFolder);
  const addFileFn = useServerFn(addFolderFile);
  const removeFileFn = useServerFn(removeFolderFile);
  const assignFn = useServerFn(assignChatToFolder);

  const q = useQuery({ queryKey: ["folder", id], queryFn: () => getFn({ data: { id } }) });

  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [instructionsDirty, setInstructionsDirty] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<
    { id: number; name: string; status: IngestStatus; file: File }[]
  >([]);
  const pendingIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data?.folder) {
      setName(q.data.folder.name);
      setInstructions(q.data.folder.instructions);
      setInstructionsDirty(false);
    }
  }, [q.data?.folder]);

  async function saveName() {
    setEditingName(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === q.data?.folder.name) {
      setName(q.data?.folder.name ?? "");
      return;
    }
    try {
      await renameFn({ data: { id, name: trimmed } });
      qc.invalidateQueries({ queryKey: ["folder", id] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename folder");
    }
  }

  async function saveInstructions() {
    setSavingInstructions(true);
    try {
      await instructionsFn({ data: { id, instructions } });
      setInstructionsDirty(false);
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success("Instructions saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save instructions");
    } finally {
      setSavingInstructions(false);
    }
  }

  // Reads + stores one pending entry; flips it to "failed" (kept, retryable) or removes it on success.
  async function uploadPending(entryId: number) {
    let entry: { id: number; name: string; file: File } | undefined;
    setPending((prev) => {
      entry = prev.find((p) => p.id === entryId);
      return prev.map((p) => (p.id === entryId ? { ...p, status: "reading" } : p));
    });
    if (!entry) return false;
    try {
      const data = await readAsBase64(entry.file);
      await addFileFn({ data: { folder_id: id, name: entry.name, data } });
      setPending((prev) => prev.filter((p) => p.id !== entryId));
      qc.invalidateQueries({ queryKey: ["folder", id] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      return true;
    } catch (e) {
      console.error(`[folders] could not add "${entry.name}":`, e);
      setPending((prev) => prev.map((p) => (p.id === entryId ? { ...p, status: "failed" } : p)));
      return false;
    }
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    const entries = Array.from(files).map((f) => ({
      id: ++pendingIdRef.current,
      name: f.name,
      status: "reading" as IngestStatus,
      file: f,
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPending((prev) => [...prev, ...entries]);
    setUploading(true);
    let failedCount = 0;
    for (const entry of entries) {
      const ok = await uploadPending(entry.id);
      if (!ok) failedCount++;
    }
    setUploading(false);
    if (failedCount)
      toast.warning(
        `Couldn't read ${failedCount} file${failedCount > 1 ? "s" : ""} — retry from the list`,
      );
    else toast.success("Files added to folder");
  }

  function dismissPending(entryId: number) {
    setPending((prev) => prev.filter((p) => p.id !== entryId));
  }

  async function removeFile(fileId: string) {
    try {
      await removeFileFn({ data: { id: fileId } });
      qc.invalidateQueries({ queryKey: ["folder", id] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove file");
    }
  }

  async function removeChat(chatId: string) {
    try {
      await assignFn({ data: { chat_id: chatId, folder_id: null } });
      qc.invalidateQueries({ queryKey: ["folder", id] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove chat");
    }
  }

  async function removeFolder() {
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["folders"] });
      navigate({ to: "/app/folders" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete folder");
    }
  }

  if (q.isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (q.isError || !q.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl p-6">
          <Link
            to="/app/folders"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" /> Folders
          </Link>
          <Card className="p-8 text-center text-muted-foreground">
            This folder could not be found.
          </Card>
        </div>
      </AppShell>
    );
  }

  const files = q.data.files;
  const chats = q.data.chats;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <Link
          to="/app/folders"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Folders
        </Link>

        {/* Header / name */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Folder className="size-5" />
          </div>
          {editingName ? (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setName(q.data!.folder.name);
                  setEditingName(false);
                }
              }}
              autoFocus
              className="text-lg font-semibold"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="group flex min-w-0 items-center gap-2 text-left"
              title="Rename folder"
            >
              <h1 className="truncate text-xl font-semibold">{q.data.folder.name}</h1>
              <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>

        {/* New chat launchers */}
        <Card className="mb-4 p-4">
          <p className="mb-2.5 text-sm font-medium">Start a chat in this folder</p>
          <div className="flex flex-wrap gap-2">
            {(["analyze", "presentations", "agent"] as const).map((tool) => {
              const meta = TOOL_META[tool];
              const Icon = meta.icon;
              return (
                <Button key={tool} asChild variant="outline" size="sm">
                  <Link to={meta.to} search={{ folder: id }}>
                    <Icon className="size-4" /> {meta.label}
                  </Link>
                </Button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            New chats started here inherit this folder's instructions and files.
          </p>
        </Card>

        {/* Instructions */}
        <Card className="mb-4 p-4 space-y-3">
          <div>
            <Label htmlFor="folder-instructions" className="text-sm font-medium">
              Custom instructions
            </Label>
            <p className="text-xs text-muted-foreground">
              Applied to every chat in this folder — tone, rules, role, anything.
            </p>
          </div>
          <Textarea
            id="folder-instructions"
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              setInstructionsDirty(true);
            }}
            placeholder="e.g. You are helping me write my MSc dissertation on coastal erosion. Always use UK English and APA 7 citations."
            className="min-h-32 resize-y"
            maxLength={20000}
          />
          <div className="flex justify-end">
            <Button
              onClick={saveInstructions}
              disabled={!instructionsDirty || savingInstructions}
              size="sm"
            >
              {savingInstructions && <Loader2 className="size-4 animate-spin" />} Save instructions
            </Button>
          </div>
        </Card>

        {/* Files */}
        <Card className="mb-4 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Reference files</p>
              <p className="text-xs text-muted-foreground">
                Text from these is given to every chat in the folder.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="shrink-0"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}{" "}
              Add files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => onFilesPicked(e.target.files)}
            />
          </div>
          {files.length === 0 && pending.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
              No files yet. PDFs, Word, Excel, PowerPoint, and text all work.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pending.map((p) => (
                <li
                  key={`pending-${p.id}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  <FileText className={cn("size-4 shrink-0", ingestIconClass(p.status))} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <IngestBadge status={p.status} />
                  {p.status === "failed" && (
                    <>
                      <button
                        onClick={() => uploadPending(p.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        title="Try again"
                      >
                        <RefreshCw className="size-4" />
                      </button>
                      <button
                        onClick={() => dismissPending(p.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="Dismiss"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  )}
                </li>
              ))}
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button
                    onClick={() => removeFile(f.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Remove file"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Chats */}
        <Card className="mb-4 p-4 space-y-3">
          <p className="text-sm font-medium">Chats in this folder</p>
          {chats.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
              No chats yet. Start one above, or move an existing chat in from its history menu.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {chats.map((c) => {
                const meta = TOOL_META[c.tool] ?? TOOL_META.agent;
                const Icon = meta.icon;
                return (
                  <li
                    key={c.id}
                    className="group flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <Link
                      to={meta.to}
                      search={{ chat: c.id }}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {c.title}
                    </Link>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {meta.label}
                    </span>
                    <button
                      onClick={() => removeChat(c.id)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Remove from folder"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Danger zone */}
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" /> Delete folder
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
                <AlertDialogDescription>
                  The folder, its instructions, and its reference files are deleted. The{" "}
                  {chats.length} chat
                  {chats.length === 1 ? "" : "s"} inside stay in your history — they just stop
                  belonging to a folder.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={removeFolder}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete folder
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </AppShell>
  );
}
