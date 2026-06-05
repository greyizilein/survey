import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { countPersonas } from "@/lib/personas.functions";
import { listProjects } from "@/lib/projects.functions";
import { Users, FolderKanban, MessageSquare, Activity } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Overview · Surveyor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const countFn = useServerFn(countPersonas);
  const projFn = useServerFn(listProjects);
  const personasQ = useQuery({ queryKey: ["personas-count"], queryFn: () => countFn() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => projFn() });

  const projects = projectsQ.data ?? [];
  const totalSims = projects.reduce((acc, p: any) => acc + (p.simulations?.length ?? 0), 0);
  const completed = projects.reduce((acc, p: any) =>
    acc + ((p.simulations ?? []).filter((s: any) => s.status === "complete").length), 0);
  const successRate = totalSims ? Math.round((completed / totalSims) * 100) : 0;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold">Overview</h1>
            <p className="text-muted-foreground mt-1">Synthetic respondents at the speed of thought.</p>
          </div>
          <Button asChild><Link to="/app/projects">New project</Link></Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Stat icon={Users} label="Personas" value={personasQ.data ?? 0} />
          <Stat icon={FolderKanban} label="Projects" value={projects.length} />
          <Stat icon={MessageSquare} label="Simulations" value={totalSims} />
          <Stat icon={Activity} label="Fill rate" value={`${successRate}%`} />
        </div>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Recent projects</h2>
          {projects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No projects yet. <Link to="/app/projects" className="text-primary hover:underline">Create one</Link> to start.
            </div>
          ) : (
            <div className="divide-y">
              {projects.slice(0, 6).map((p: any) => (
                <Link key={p.id} to="/app/projects/$id" params={{ id: p.id }} className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-2 px-2 rounded">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.surveys?.length ?? 0} surveys · {p.simulations?.length ?? 0} sims</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
    </Card>
  );
}
