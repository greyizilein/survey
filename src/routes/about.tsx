import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Zap, Globe, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Paperstudio" },
      { name: "description", content: "Paperstudio is an AI writing workspace built for serious writers. Learn what we're building and why." },
    ],
  }),
  component: AboutPage,
});

const LIME = "#b6de48";

const values = [
  {
    label: "01",
    title: "Writing is work. Treat it that way.",
    body: "Blank pages are expensive. We built Paperstudio so the hardest part — getting words on the page — is never the bottleneck. Draft fast, revise smart, ship.",
  },
  {
    label: "02",
    title: "Quality over volume.",
    body: "We don't celebrate word counts. We obsess over whether the output is actually useful — structured, cited, formatted, and ready to hand in.",
  },
  {
    label: "03",
    title: "One tool, not ten.",
    body: "Writing, research, interviews, presentations, formatting, surveys — all in one workspace. No switching. No exporting between apps. Just work.",
  },
  {
    label: "04",
    title: "Built for people who write a lot.",
    body: "Students pulling late nights. Researchers writing up studies. Professionals drafting decks and reports. This is for you — not casual hobbyists.",
  },
];

const stats = [
  { value: "99%", label: "First-time user satisfaction" },
  { value: "12 min", label: "Avg. time to a 9,000-word draft" },
  { value: "5+", label: "Export formats supported" },
  { value: "APA · MLA · Chicago", label: "Citation styles built in" },
];

function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="flex items-center justify-between border-b-2 border-border px-6 py-4 sm:px-10">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-sm font-bold tracking-tight uppercase">Paperstudio</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link to="/about" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-primary">About</Link>
          <Link to="/pricing" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-foreground/60 hover:text-foreground transition-colors">Pricing</Link>
          <Link to="/contact" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-foreground/60 hover:text-foreground transition-colors">Contact</Link>
          <Link to="/auth" className="border-2 border-foreground bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hard-shadow-sm hard-shadow-hover">
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b-2 border-border px-6 py-20 sm:px-10 sm:py-32">
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-30"
          style={{ background: `radial-gradient(ellipse at top right, ${LIME}44, transparent 60%)` }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-5xl">
          <span className="inline-flex items-center gap-2 border-2 border-primary bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-primary">
            Our story
          </span>
          <h1 className="mt-6 text-[clamp(3rem,10vw,7rem)] font-extrabold leading-[0.92] tracking-tight text-balance">
            Writing, built for the{" "}
            <span className="text-primary">people who do it seriously.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Paperstudio is an AI-powered writing workspace for students, researchers, and professionals. Not a chatbot. Not a spell-checker. A full production environment for the written word.
          </p>
          <Link
            to="/pricing"
            className="mt-10 inline-flex items-center gap-2 border-2 border-primary bg-primary px-6 py-3.5 text-sm font-bold uppercase tracking-widest text-primary-foreground hard-shadow-sm hard-shadow-hover"
          >
            See pricing <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-b-2 border-border bg-accent/5">
        <div className="mx-auto grid max-w-5xl grid-cols-2 divide-x-2 divide-border lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="px-6 py-10 sm:px-10">
              <p className="text-3xl font-extrabold text-primary sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Mission */}
      <section className="border-b-2 border-border px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Mission</span>
              <h2 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                We exist so writing never holds you back.
              </h2>
            </div>
            <div className="flex flex-col justify-center gap-5 text-base leading-relaxed text-muted-foreground">
              <p>
                Writing has always been one of the most cognitively expensive things a person can do. We think that&apos;s fine for the ideas part. Not fine for the formatting, the citations, the blank-page paralysis.
              </p>
              <p>
                Paperstudio takes the mechanical cost out of writing. You bring the thinking. We handle the production. The result is work you&apos;re proud to put your name on — and finished in a fraction of the time.
              </p>
              <p>
                We&apos;re a small team with one north star: the best writing workspace on earth. Nothing more.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-b-2 border-border px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Values</span>
          <h2 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">What we believe.</h2>
          <div className="mt-14 grid gap-0 divide-y-2 divide-border border-y-2 border-border">
            {values.map((v) => (
              <div key={v.label} className="grid gap-4 py-8 sm:grid-cols-[4rem_1fr_2fr] sm:gap-10 sm:py-10">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">{v.label}</span>
                <h3 className="text-lg font-bold leading-snug">{v.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features quick-hits */}
      <section className="border-b-2 border-border px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">What&apos;s inside</span>
          <h2 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">One workspace. Everything you write.</h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Zap, title: "AI Writer", desc: "Chapters, reports, and essays generated from your instructions and sources." },
              { icon: Globe, title: "Survey Autofill", desc: "Paste any Google Forms link. Paperstudio answers and submits in character." },
              { icon: Users, title: "Interview Studio", desc: "Upload a discussion guide. Get full transcripts per AI respondent." },
              { icon: ShieldCheck, title: "Formatting", desc: "APA, MLA, Chicago. Cover pages, hanging indents, running heads — submission-ready." },
            ].map((f) => (
              <div key={f.title} className="border-2 border-border p-6 transition-shadow hover:border-primary/50">
                <f.icon className="size-6 text-primary" />
                <h3 className="mt-4 text-base font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-foreground px-6 py-20 text-background sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Ready to write something great?
            </h2>
            <div className="flex flex-col gap-4 sm:flex-row lg:justify-end">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 border-2 border-background bg-background px-6 py-3.5 text-sm font-bold uppercase tracking-widest text-foreground"
              >
                Start free <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 border-2 border-background/40 px-6 py-3.5 text-sm font-bold uppercase tracking-widest text-background/70 hover:border-background hover:text-background transition-colors"
              >
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-border px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="size-7" />
            <span className="text-xs font-bold uppercase tracking-tight">Paperstudio</span>
          </Link>
          <div className="flex flex-wrap gap-6 text-xs uppercase tracking-widest text-muted-foreground">
            <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link to="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </div>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">© {new Date().getFullYear()} Paperstudio</span>
        </div>
      </footer>
    </div>
  );
}
