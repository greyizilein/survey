import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardPenLine, Users, FolderKanban, Download, ArrowUpRight } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Home · Surveyor" }] }),
  component: Home,
});

const cards = [
  {
    to: "/app/fill",
    icon: ClipboardPenLine,
    title: "Fill a survey",
    description: "Paste a survey link and generate realistic answers from AI respondents.",
    big: true,
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
  {
    to: "/app/extension",
    icon: Download,
    title: "Extension",
    description: "Install the browser extension to fill forms directly.",
  },
] as const;

function Home() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="mb-8 border-2 border-foreground bg-accent p-6 sm:p-10 hard-shadow">
          <p className="text-sm font-semibold uppercase tracking-[0.2em]">Welcome back</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-extrabold tracking-tight">
            Let's run a survey.
          </h1>
          <p className="mt-3 max-w-xl text-sm sm:text-base text-accent-foreground/80">
            Generate realistic survey responses and fill live forms with AI-driven personas — built from scratch for every audience.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.to}
              to={card.to}
              className={"big" in card ? "sm:col-span-2" : ""}
            >
              <div className="group h-full border-2 border-foreground bg-card p-6 hard-shadow-sm hard-shadow-hover">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-12 items-center justify-center border-2 border-foreground bg-primary text-primary-foreground">
                    <card.icon className="size-6" />
                  </div>
                  <ArrowUpRight className="size-6 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                </div>
                <h2 className="mt-4 text-xl font-bold">{card.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
