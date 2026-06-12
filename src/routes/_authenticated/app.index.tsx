import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardPenLine, Users, FolderKanban, Download, ArrowRight } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";

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
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome to Surveyor</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Generate realistic survey responses and fill forms using AI-driven personas.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link key={card.to} to={card.to}>
              <Card className="p-5 h-full transition-colors hover:bg-accent/50">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <card.icon className="size-5 text-secondary-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-medium">{card.title}</h2>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
