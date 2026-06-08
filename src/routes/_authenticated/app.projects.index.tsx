import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject, deleteProject, listProjects } from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/app/projects/")({
  head: () => ({ meta: [{ title: "Projects · Surveyor" }] }),
  component: Projects,
});

function Projects() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProjects);
  const createFn = useServerFn(createProject);
  const delFn = useServerFn(deleteProject);
  const q = useQuery({ queryKey: ["projects"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) {
      toast.error("Add a project name");
      return;
    }
    setSaving(true);
    try {
      await createFn({ data: { name, description: desc } });
      setName("");
      setDesc("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">One workspace per survey or research question.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto"><Plus className="size-4" /> New project</Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
              <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Description (optional)</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} /></div>
                <Button onClick={create} className="w-full" disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(q.data ?? []).map((p: any) => (
            <Card key={p.id} className="group p-5 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between">
                <FolderKanban className="size-5 text-primary" />
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!confirm("Delete project?")) return;
                    await delFn({ data: { id: p.id } });
                    qc.invalidateQueries({ queryKey: ["projects"] });
                    toast.success("Project deleted");
                  }}
                  className="rounded p-1 text-muted-foreground opacity-100 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Link to="/app/projects/$id" params={{ id: p.id }} className="block mt-3">
                <div className="font-semibold">{p.name}</div>
                <div className="mt-1 min-h-[2rem] text-xs text-muted-foreground line-clamp-2">{p.description || "No description"}</div>
                <div className="mt-3 text-xs text-muted-foreground">{p.surveys?.length ?? 0} surveys · {p.simulations?.length ?? 0} sims</div>
              </Link>
            </Card>
          ))}
          {(q.data ?? []).length === 0 && (
            <Card className="p-10 text-center text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
              No projects yet. Use New project to create a real workspace.
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}