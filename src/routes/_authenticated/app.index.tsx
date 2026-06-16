import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardPenLine, Users, FolderKanban, ArrowUpRight,
  Sparkles, Wand2, Globe, Gauge, MessageSquareText,
} from "lucide-react";

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
    to: "/app/interviews",
    icon: MessageSquareText,
    title: "Interview Studio",
    description: "Upload your study and guide; get a full interview transcript per respondent to download.",
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

const steps = [
  {
    icon: Sparkles,
    title: "Build a population",
    description: "Generate hundreds or thousands of distinct AI personas in Persona Studio — different ages, jobs, locations, and personalities.",
  },
  {
    icon: ClipboardPenLine,
    title: "Paste a survey link",
    description: "Drop in any Google Forms link. Surveyor reads every question and figures out how to answer it.",
  },
  {
    icon: Wand2,
    title: "Generate & submit",
    description: "Each persona writes in-character answers, with adjustable length, variation, and tone — then submits straight to the live form.",
  },
];

const stats = [
  { value: "1,000s", label: "of personas per population" },
  { value: "100%", label: "AI-written, in-character answers" },
  { value: "1 click", label: "to submit a full batch" },
  { value: "24/7", label: "ready whenever you are" },
];

const logos = ["Google Forms", "Persona Studio", "Surveyor", "Projects", "Populations"];

function Home() {
  return (
    <AppShell>
      <div className="overflow-x-hidden">
        {/* Hero */}
        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden border-b-2 border-foreground bg-foreground px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div
            className="absolute -left-16 top-10 size-40 rounded-full bg-primary/30 blur-2xl animate-float"
            aria-hidden
          />
          <div
            className="absolute right-0 top-24 size-56 rounded-full bg-primary/20 blur-3xl animate-float-delay"
            aria-hidden
          />

          <div className="absolute right-6 top-8 hidden sm:block animate-float">
            <div className="flex size-14 items-center justify-center border-2 border-primary bg-background rotate-[8deg]">
              <Globe className="size-6 text-primary" />
            </div>
          </div>
          <div className="absolute left-10 bottom-10 hidden sm:block animate-float-delay">
            <div className="flex size-12 items-center justify-center border-2 border-primary bg-background rotate-[-6deg]">
              <Gauge className="size-5 text-primary" />
            </div>
          </div>

          <div className="relative mx-auto max-w-3xl text-center animate-fade-up">
            <span className="inline-block border-2 border-primary bg-background px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              Welcome back
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-background sm:text-6xl">
              Let's run a survey.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm text-background/70 sm:text-base">
              Generate realistic survey responses and fill live forms with AI-driven personas — built from scratch for every audience.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/app/fill"
                className="border-2 border-primary bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
              >
                Fill a survey now
              </Link>
              <Link
                to="/app/personas"
                className="border-2 border-background px-6 py-3 text-sm font-bold text-background hard-shadow-hover"
              >
                Build a population
              </Link>
            </div>
          </div>
        </section>

        {/* Logo marquee */}
        <section className="border-b-2 border-foreground bg-secondary py-4">
          <div className="flex overflow-hidden">
            <div className="flex shrink-0 animate-marquee gap-12 pr-12">
              {[...logos, ...logos].map((logo, i) => (
                <span key={i} className="shrink-0 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  {logo}
                </span>
              ))}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          {/* Quick links */}
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

          {/* How it works */}
          <div className="mt-20">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">How it works</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {steps.map((step, i) => (
                <div key={step.title} className="relative border-2 border-foreground bg-card p-6 hard-shadow-sm">
                  <span className="absolute -top-4 -left-1 flex size-9 items-center justify-center border-2 border-foreground bg-accent text-sm font-extrabold">
                    {i + 1}
                  </span>
                  <step.icon className="size-6" />
                  <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="mt-20 border-2 border-foreground bg-foreground p-8 hard-shadow sm:p-12">
            <div className="grid gap-8 text-center sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <div className="text-3xl font-extrabold text-primary sm:text-4xl">{stat.value}</div>
                  <div className="mt-2 text-xs uppercase tracking-widest text-background/70 sm:text-sm">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-20 border-2 border-foreground bg-accent p-8 text-center hard-shadow sm:p-12">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Ready when you are.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-accent-foreground/80">
              Paste a survey link, pick a population, and let Surveyor do the rest.
            </p>
            <Link
              to="/app/fill"
              className="mt-6 inline-block border-2 border-foreground bg-foreground px-6 py-3 text-sm font-bold text-background hard-shadow-sm hard-shadow-hover"
            >
              Get started
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
