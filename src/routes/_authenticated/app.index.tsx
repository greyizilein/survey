import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ClipboardPenLine, Users, FolderKanban, ArrowUpRight, LogOut,
  MessageSquareText, BarChart3, Presentation, Bot, ClipboardCheck, ArrowRight,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { clearPasskey } from "@/lib/passkey";
import { getProfileSummary } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Home · Paperstudio" }] }),
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
    to: "/app/analyze",
    search: { corrections: "1" },
    icon: ClipboardCheck,
    title: "Corrections",
    description: "Upload reviewer feedback (.docx with tracked changes, or pasted comments) and apply it to your draft automatically.",
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

function Home() {
  const router = useRouter();
  const getProfileSummaryFn = useServerFn(getProfileSummary);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    getProfileSummaryFn()
      .then(({ displayName }) => setDisplayName(displayName))
      .catch(() => setDisplayName(null));
  }, []);

  const name = displayName || email?.split("@")[0] || "there";

  async function signOut() {
    clearPasskey();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b-2 border-border px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="size-8 bg-primary flex items-center justify-center text-primary-foreground font-bold text-base border-2 border-foreground rotate-[-3deg]">P</div>
          <span className="font-bold tracking-tight text-lg">Paperstudio</span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome back, {name}.</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Step into Office to pick a tool, or jump straight in below.</p>
          </div>
          <Link
            to="/app/dashboard"
            className="inline-flex items-center gap-2 border-2 border-foreground bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
          >
            Enter Office <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-bold">Tools</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <Link key={card.title} to={card.to} search={"search" in card ? card.search : undefined} className={"big" in card ? "sm:col-span-2 lg:col-span-3" : ""}>
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
      </div>
    </div>
  );
}
