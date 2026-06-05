import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { listProjects, createProject, deleteProject } from "@/lib/projects.functions";
import { Plus, Trash2, FolderKanban } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects")({
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

  async function create() {
    if (!name.trim()) return;
    try {
      await createFn({ data: { name, description: desc } });
      setName(""); setDesc(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold">Projects</h1>
            <p className="text-muted-foreground mt-1">One workspace per survey or research question.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4 mr-1" /> New project</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Description (optional)</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} /></div>
                <Button onClick={create} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(q.data ?? []).map((p: any) => (
            <Card key={p.id} className="p-5 hover:border-primary/40 transition-colors group">
              <div className="flex items-start justify-between">
                <FolderKanban className="size-5 text-primary" />
                <button onClick={async (e) => {
                  e.preventDefault();
                  if (!confirm("Delete project?")) return;
                  await delFn({ data: { id: p.id } });
                  qc.invalidateQueries({ queryKey: ["projects"] });
                }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Link to="/app/projects/$id" params={{ id: p.id }} className="block mt-3">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2rem]">{p.description || "No description"}</div>
                <div className="text-xs text-muted-foreground mt-3">{p.surveys?.length ?? 0} surveys · {p.simulations?.length ?? 0} sims</div>
              </Link>
            </Card>
          ))}
          {(q.data ?? []).length === 0 && (
            <Card className="md:col-span-2 lg:col-span-3 p-12 text-center text-muted-foreground text-sm">No projects yet.</Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
