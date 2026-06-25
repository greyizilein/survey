import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Loader2,
  Clock,
  LayoutDashboard,
  MessageSquareText,
  FolderOpen,
  Mic,
  Globe,
  Users,
  PenLine,
  Presentation,
  Bot,
  ClipboardPenLine,
  ArrowUpRight,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AnimatedRing } from "@/components/animated-ring";
import { getDashboardSummary } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Paperstudio" }] }),
  component: Dashboard,
});

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;

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

const ACTIVITY_DOT: Record<string, string> = {
  Writing: "hsl(var(--primary))",
  Presentations: "#0ea5e9",
  Agent: "#a855f7",
  Project: "#f97316",
  "Interview study": "#ec4899",
  Population: "#b6de48",
};

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

  const c = summary?.counts;
  const statCards = [
    { label: "Chats", value: c?.chats ?? 0, icon: <MessageSquareText size={16} />, max: 50 },
    { label: "Projects", value: c?.projects ?? 0, icon: <FolderOpen size={16} />, max: 20 },
    { label: "Interviews", value: c?.interviewStudies ?? 0, icon: <Mic size={16} />, max: 10 },
    { label: "Populations", value: c?.populations ?? 0, icon: <Globe size={16} />, max: 10 },
    { label: "Personas", value: c?.personas ?? 0, icon: <Users size={16} />, max: 5000 },
  ];

  const quickActions = [
    { icon: <PenLine size={16} />, title: "Open writer", desc: "Start a new document", to: "/app/analyze" },
    { icon: <Presentation size={16} />, title: "New deck", desc: "Generate slides", to: "/app/presentations" },
    { icon: <ClipboardPenLine size={16} />, title: "Fill a survey", desc: "Paste a form link", to: "/app/fill" },
    { icon: <Bot size={16} />, title: "Run agent", desc: "Open-ended task", to: "/app/agent" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-10 lg:py-14 lg:px-8">
        {/* Header */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="grid size-8 sm:size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <LayoutDashboard className="size-4 sm:size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl lg:text-3xl">Dashboard</h1>
            <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
              {summary?.displayName ? `Welcome back, ${summary.displayName}.` : "An overview of everything across your workspace."}
            </p>
          </div>
        </div>

        {/* Stat ring cards */}
        <div className="mt-5 sm:mt-8 grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map((s) => (
            <StatRingCard key={s.label} {...s} loading={loading} />
          ))}
        </div>

        {/* Two-column area */}
        <div className="mt-6 sm:mt-8 grid gap-3 sm:gap-5 lg:grid-cols-3">
          {/* Quick actions */}
          <div className="rounded-xl sm:rounded-2xl border border-border bg-card p-3 sm:p-5">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
              Quick actions
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {quickActions.map((a) => (
                <Link
                  key={a.title}
                  to={a.to}
                  className="group flex flex-col items-start gap-1 rounded-xl border border-border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5"
                >
                  <div className="text-primary">{a.icon}</div>
                  <div className="text-[12px] font-bold text-foreground">{a.title}</div>
                  <div className="text-[10px] leading-tight text-muted-foreground">{a.desc}</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-xl sm:rounded-2xl border border-border bg-card p-3 sm:p-5 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                Recent activity
              </div>
              <Link
                to="/app/projects"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
              >
                See all <ArrowUpRight size={12} />
              </Link>
            </div>

            <div className="mt-3 sm:mt-4">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : !summary?.activity.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing yet — start a chat, run an interview study, or fill a survey to see it here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {summary.activity.map((item, i) => (
                    <li key={i}>
                      <Link
                        to={item.href}
                        className="group flex items-start gap-3 py-3 transition-colors hover:bg-secondary/40 -mx-2 px-2 rounded-lg"
                      >
                        <div
                          className="mt-1.5 size-2 shrink-0 rounded-full"
                          style={{ background: ACTIVITY_DOT[item.kind] ?? "hsl(var(--primary))" }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="font-medium">{item.kind}</span>
                            <span>·</span>
                            <Clock className="size-3" />
                            {timeAgo(item.at)}
                          </p>
                        </div>
                        <ArrowUpRight
                          size={14}
                          className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        />
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

function StatRingCard({
  label,
  value,
  max,
  icon,
  loading,
}: {
  label: string;
  value: number;
  max: number;
  icon: React.ReactNode;
  loading: boolean;
}) {
  const [display, setDisplay] = useState(0);
  const pct = max ? Math.min(Math.round((value / max) * 100), 100) : 0;

  useEffect(() => {
    if (!value) {
      setDisplay(0);
      return;
    }
    const dur = 800;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(ease * value));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);

  const formatted = display >= 1000 ? `${(display / 1000).toFixed(1)}k` : `${display}`;

  return (
    <div className="flex items-center gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border border-border bg-card p-2.5 sm:p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40">
      <div className="relative shrink-0">
        <AnimatedRing size={40} strokeWidth={4} percent={pct} color="hsl(var(--primary))" className="sm:hidden">
          <foreignObject x={4} y={4} width={32} height={32}>
            <div className="flex h-full w-full items-center justify-center text-foreground">{icon}</div>
          </foreignObject>
        </AnimatedRing>
        <AnimatedRing size={52} strokeWidth={4} percent={pct} color="hsl(var(--primary))" className="hidden sm:block">
          <foreignObject x={10} y={10} width={32} height={32}>
            <div className="flex h-full w-full items-center justify-center text-foreground">{icon}</div>
          </foreignObject>
        </AnimatedRing>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-[0.1em] sm:tracking-[0.12em] text-muted-foreground truncate">
          {label}
        </div>
        <div className="text-lg sm:text-xl font-black leading-tight text-foreground">
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : formatted}
        </div>
      </div>
    </div>
  );
}
