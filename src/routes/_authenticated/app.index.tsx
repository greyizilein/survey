import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ClipboardPenLine, Users, FolderKanban, ArrowUpRight, Loader2,
  MessageSquareText, BarChart3, Presentation, Bot, Clock,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { getDashboardSummary } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Dashboard · Paperstudio" }] }),
  component: Home,
});

const cards = [
  {
    to: "/app/analyze",
    icon: BarChart3,
    title: "Writing",
    description: "An AI-assisted writing workspace for chapters, reports, and analysis — with your data, sources, and instructions baked in.",
    big: true,
  },
  {
    to: "/app/fill",
    icon: ClipboardPenLine,
    title: "Fill a survey",
    description: "Paste a survey link and generate realistic answers from AI respondents.",
  },
  {
    to: "/app/interviews",
    icon: MessageSquareText,
    title: "Interview Studio",
    description: "Upload your study and guide; get a full interview transcript per respondent to download.",
  },
  {
    to: "/app/presentations",
    icon: Presentation,
    title: "Presentations",
    description: "Describe the deck you need and get live, editable slides you can export to .pptx.",
  },
  {
    to: "/app/agent",
    icon: Bot,
    title: "Agent",
    description: "An open-ended assistant that analyzes, writes, and builds presentations end to end.",
  },
  {
    to: "/app/personas",
    icon: Users,
    title: "Persona Studio",
    description: "Create and manage reusable populations of respondents.",
  },
  {
    to: "/app/projects",
    icon: FolderKanban,
    title: "Projects",
    description: "Review past survey fill runs and their results.",
  },
] as const;

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

function Home() {
  const getDashboardSummaryFn = useServerFn(getDashboardSummary);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    getDashboardSummaryFn()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  const name = summary?.displayName || email?.split("@")[0] || "there";
  const stats = summary?.counts;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {/* Greeting */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome back, {name}.</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Here's what's happening across your workspace.</p>
          </div>
          <Link
            to="/app/analyze"
            className="border-2 border-foreground bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
          >
            Start writing
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Chats", value: stats?.chats },
            { label: "Projects", value: stats?.projects },
            { label: "Interview studies", value: stats?.interviewStudies },
            { label: "Populations", value: stats?.populations },
            { label: "Personas", value: stats?.personas },
          ].map((s) => (
            <div key={s.label} className="border-2 border-foreground bg-card p-4 hard-shadow-sm">
              <div className="text-2xl font-extrabold text-primary">
                {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : s.value ?? 0}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-3">
          {/* Quick links */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-bold">Tools</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {cards.map((card) => (
                <Link key={card.to} to={card.to} className={"big" in card ? "sm:col-span-2" : ""}>
                  <div className="group h-full border-2 border-foreground bg-card p-5 hard-shadow-sm hard-shadow-hover">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex size-10 items-center justify-center border-2 border-foreground bg-primary text-primary-foreground">
                        <card.icon className="size-5" />
                      </div>
                      <ArrowUpRight className="size-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                    </div>
                    <h3 className="mt-3 text-base font-bold">{card.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div>
            <h2 className="text-lg font-bold">Recent activity</h2>
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
