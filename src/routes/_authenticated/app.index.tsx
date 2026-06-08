import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Activity, FolderKanban, MessageSquare, Users } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { countPersonas } from "@/lib/personas.functions";
import { listProjects } from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Overview · Surveyor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const countFn = useServerFn(countPersonas);
  const projFn = useServerFn(listProjects);
  const personasQ = useQuery({ queryKey: ["personas-count"], queryFn: () => countFn() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => projFn() });

  const projects = projectsQ.data ?? [];
  const totalSims = projects.reduce((acc: number, p: any) => acc + (p.simulations?.length ?? 0), 0);
  const completed = projects.reduce(
    (acc: number, p: any) => acc + ((p.simulations ?? []).filter((s: any) => s.status === "complete").length),
    0,
  );
  const successRate = totalSims ? Math.round((completed / totalSims) * 100) : 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">Synthetic respondents at the speed of thought.</p>
          </div>
          <Button asChild className="w-full sm:w-auto">
            <Link to="/app/projects">New project</Link>
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 lg:grid-cols-4 lg:gap-4">
          <Stat icon={Users} label="Personas" value={personasQ.data ?? 0} />
          <Stat icon={FolderKanban} label="Projects" value={projects.length} />
          <Stat icon={MessageSquare} label="Simulations" value={totalSims} />
          <Stat icon={Activity} label="Fill rate" value={`${successRate}%`} />
        </div>

        <Card className="p-4 sm:p-6">
          <h2 className="mb-4 text-base font-semibold sm:text-lg">Recent projects</h2>
          {projects.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground sm:py-12">
              No projects yet. <Link to="/app/projects" className="text-primary hover:underline">Create one</Link> to start.
            </div>
          ) : (
            <div className="divide-y">
              {projects.slice(0, 6).map((p: any) => (
                <Link
                  key={p.id}
                  to="/app/projects/$id"
                  params={{ id: p.id }}
                  className="flex flex-col gap-1 rounded px-2 py-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
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
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] uppercase text-muted-foreground sm:text-xs">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</div>
    </Card>
  );
}