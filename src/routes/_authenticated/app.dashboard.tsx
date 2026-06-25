import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Clock, LayoutDashboard } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";

import { AppShell } from "@/components/app-shell";
import { getDashboardSummary } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Paperstudio" }] }),
  component: Dashboard,
});

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;

const BAR_COLORS = ["#84cc16", "#0ea5e9", "#f97316", "#a855f7", "#ec4899"];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Dashboard() {
  const getDashboardSummaryFn = useServerFn(getDashboardSummary);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardSummaryFn()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  const stats = summary?.counts;
  const statRows = [
    { label: "Chats", value: stats?.chats },
    { label: "Projects", value: stats?.projects },
    { label: "Interview studies", value: stats?.interviewStudies },
    { label: "Populations", value: stats?.populations },
    { label: "Personas", value: stats?.personas },
  ];
  const chartData = statRows.map((s) => ({ name: s.label, value: s.value ?? 0 }));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex items-center gap-2.5">
          <LayoutDashboard className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">An overview of everything across your workspace.</p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {statRows.map((s) => (
            <div key={s.label} className="border-2 border-foreground bg-card p-4 hard-shadow-sm">
              <div className="text-2xl font-extrabold text-primary">
                {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : s.value ?? 0}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {/* Activity breakdown chart */}
          <div className="lg:col-span-2 border-2 border-foreground bg-card p-5 hard-shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Activity breakdown</h2>
            <div className="mt-4 h-64">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Recent activity */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Recent activity</h2>
            <div className="mt-4 border-2 border-foreground bg-card hard-shadow-sm">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : !summary?.activity.length ? (
                <p className="p-5 text-sm text-muted-foreground">Nothing yet — start a chat, run an interview study, or fill a survey to see it here.</p>
              ) : (
                <ul className="divide-y-2 divide-foreground">
                  {summary.activity.map((item, i) => (
                    <li key={i}>
                      <Link to={item.href} className="flex items-start gap-3 p-4 hover:bg-secondary/60 transition-colors">
                        <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.kind} · {timeAgo(item.at)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
