import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardPenLine, Users, Wand2, Sparkles, Globe, Gauge, FileDown } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Surveyor — Paste a link. Fill the survey." },
      { name: "description", content: "Surveyor fills live surveys for you with realistic AI personas. Paste any Google Forms link and watch it answer, write, and submit — at scale." },
      { property: "og:title", content: "Surveyor — Paste a link. Fill the survey." },
      { property: "og:description", content: "Paste any survey link. Surveyor reads every question and submits authentic answers from AI respondents." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-foreground text-background">
      {/* HERO — near-fullscreen */}
      <section className="relative flex min-h-[100svh] flex-col overflow-hidden px-5 pb-10 pt-5 sm:px-8">
        {/* Header */}
        <header className="relative z-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center border-2 border-primary bg-background text-foreground font-extrabold">
              S
            </div>
            <span className="text-sm font-bold tracking-tight">Surveyor</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden sm:inline-flex border-2 border-background/30 px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hover:border-background"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="border-2 border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground hard-shadow-sm hard-shadow-hover"
            >
              Get started
            </Link>
          </div>
        </header>

        {/* Ambient glows */}
        <div className="pointer-events-none absolute -left-32 top-1/4 size-[28rem] rounded-full bg-primary/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -right-24 top-10 size-[22rem] rounded-full bg-accent/25 blur-[100px]" aria-hidden />
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[60vh] w-[80vw] -translate-x-1/2 opacity-60"
          style={{ background: "radial-gradient(ellipse at top, color-mix(in oklab, var(--color-primary) 30%, transparent), transparent 60%)" }}
          aria-hidden
        />

        {/* Floating chips top */}
        <div className="pointer-events-none absolute inset-x-0 top-24 mx-auto hidden max-w-3xl sm:block">
          <div className="relative h-32">
            <Chip className="absolute left-4 top-2 rotate-[-8deg] animate-float">
              <ClipboardPenLine className="size-4" /> Google Forms
            </Chip>
            <Chip className="absolute right-6 top-0 rotate-[6deg] animate-float-delay">
              <Sparkles className="size-4" /> 1,243 personas
            </Chip>
            <Chip className="absolute left-1/2 top-16 -translate-x-1/2 animate-float">
              <Wand2 className="size-4" /> Auto-fill
            </Chip>
          </div>
        </div>

        {/* Centered headline */}
        <div className="relative z-10 mx-auto flex flex-1 max-w-3xl flex-col items-center justify-center text-center animate-fade-up">
          <span className="inline-flex items-center gap-2 border-2 border-primary/70 bg-background/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-primary backdrop-blur">
            <Sparkles className="size-3" /> Surveys, on autopilot
          </span>

          <h1 className="mt-6 text-[clamp(2.75rem,11vw,6rem)] font-extrabold leading-[0.95] tracking-tight">
            Paste a link.<br />
            <span className="text-primary">Fill the survey.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base text-background/70 sm:text-lg">
            Drop in any Google Forms link. Surveyor reads every question, writes real, in-character answers, and submits — for one persona or a thousand.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className="group inline-flex items-center gap-2 border-2 border-primary bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
            >
              Start filling free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 border-2 border-background/40 px-6 py-3.5 text-sm font-bold text-background hover:border-background"
            >
              See a demo
            </Link>
          </div>
        </div>

        {/* Floating chips bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-24 mx-auto hidden max-w-3xl sm:block">
          <div className="relative h-24">
            <Chip className="absolute left-2 bottom-0 rotate-[7deg] animate-float-delay">
              <Globe className="size-4" /> Live submit
            </Chip>
            <Chip className="absolute right-2 bottom-6 rotate-[-5deg] animate-float">
              <Gauge className="size-4" /> 12s / response
            </Chip>
          </div>
        </div>

        {/* Trust strip */}
        <div className="relative z-10 mt-auto pt-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.3em] text-background/50">
            Trusted by researchers, founders & students
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm font-bold tracking-widest text-background/70">
            <span>GOOGLE FORMS</span>
            <span className="hidden sm:inline">·</span>
            <span>MS FORMS</span>
            <span className="hidden sm:inline">·</span>
            <span>TYPEFORM</span>
            <span className="hidden sm:inline">·</span>
            <span>QUALTRICS</span>
          </div>
        </div>
      </section>

      {/* Light panel below — kept minimal */}
      <section className="bg-background text-foreground">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            Built for the boring part of research.
          </h2>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground">
            Surveyor handles every question type, writes in voice, and submits straight to the live form. You keep the insights.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Feature icon={Users} title="Diverse personas" desc="Thousands of distinct AI respondents, each with a real point of view." />
            <Feature icon={Globe} title="Any survey link" desc="Paste a Google Forms URL — Surveyor parses the whole thing instantly." />
            <Feature icon={Wand2} title="In-character answers" desc="Free text, multi-choice, scales — written like a human would." />
            <Feature icon={FileDown} title="CSV + transcripts" desc="Export clean CSVs and VTT-style interview transcripts." />
          </div>

          <div className="mt-16 border-2 border-foreground bg-accent p-8 text-center hard-shadow sm:p-12">
            <h3 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Stop filling surveys by hand.</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-accent-foreground/80">
              One link, one click, one population. Surveyor does the rest.
            </p>
            <Link
              to="/auth"
              className="mt-6 inline-flex items-center gap-2 border-2 border-foreground bg-foreground px-6 py-3 text-sm font-bold text-background hard-shadow-sm hard-shadow-hover"
            >
              Get started <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`pointer-events-auto inline-flex items-center gap-2 border-2 border-primary bg-background px-3 py-1.5 text-xs font-bold text-foreground hard-shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm hard-shadow-hover">
      <div className="flex size-10 items-center justify-center border-2 border-foreground bg-primary text-primary-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
