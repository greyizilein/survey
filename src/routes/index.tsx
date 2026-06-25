import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, ClipboardPenLine, Users, Wand2, Sparkles, Globe, Gauge, FileDown, Zap, ShieldCheck, BarChart3, Presentation, Bot, MessageSquareText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paperstudio — A full writing workspace, powered by AI." },
      { name: "description", content: "Paperstudio is a full writing workspace: AI-written documents, presentations, interview studies, survey autofill, and an open-ended writing agent, all in one place." },
      { property: "og:title", content: "Paperstudio — A full writing workspace, powered by AI." },
      { property: "og:description", content: "Write chapters, build decks, run interview studies, and fill surveys — all written by AI, in one workspace." },
    ],
  }),
  component: Landing,
});

// Fixed dark palette for the hero so contrast is correct in any theme.
const INK = "#0a0a0a";
const PAPER = "#f4f4ef";
const LIME = "#b6de48";

const marqueeItems = [
  { icon: BarChart3, label: "Writing in progress" },
  { icon: Presentation, label: "Deck exported to .pptx" },
  { icon: Bot, label: "Agent building a draft" },
  { icon: MessageSquareText, label: "Interview transcript ready" },
  { icon: ClipboardPenLine, label: "Google Forms" },
  { icon: Sparkles, label: "1,243 personas live" },
  { icon: Wand2, label: "Auto-fill engaged" },
  { icon: Globe, label: "Submitting in EU-West" },
  { icon: Gauge, label: "12s avg / response" },
  { icon: Users, label: "Persona: Maya, 27, designer" },
  { icon: Zap, label: "Streaming answers" },
  { icon: ShieldCheck, label: "Human-grade text" },
  { icon: FileDown, label: "CSV + transcripts exported" },
];

function Landing() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const ctaHref = authed ? "/app/dashboard" : "/auth";

  return (
    <div className="min-h-screen" style={{ background: INK, color: PAPER }}>
      {/* HERO — near-fullscreen */}
      <section
        className="relative flex min-h-[100svh] flex-col overflow-hidden px-5 pb-6 pt-5 sm:px-8 md:min-h-[84svh]"
        style={{ background: INK, color: PAPER }}
      >
        {/* Header */}
        <header className="relative z-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div
              className="flex size-9 items-center justify-center border-2 font-extrabold"
              style={{ background: LIME, borderColor: LIME, color: INK }}
            >
              P
            </div>
            <span className="text-sm font-bold tracking-tight" style={{ color: PAPER }}>
              Paperstudio
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {!authed && (
              <Link
                to="/auth"
                className="hidden sm:inline-flex border-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors"
                style={{ borderColor: "rgba(244,244,239,0.25)", color: PAPER }}
              >
                Sign in
              </Link>
            )}
            <Link
              to={ctaHref}
              className="lime-cta border-2 px-4 py-2 text-xs font-bold uppercase tracking-widest hard-shadow-sm hard-shadow-hover"
              style={{ background: LIME, borderColor: LIME, color: INK }}
            >
              {authed ? "Office" : "Get started"}
            </Link>
          </div>
        </header>

        {/* Ambient glows */}
        <div
          className="pointer-events-none absolute -left-32 top-1/4 size-[28rem] rounded-full blur-[120px]"
          style={{ background: `${LIME}33` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 top-10 size-[22rem] rounded-full blur-[100px]"
          style={{ background: `${LIME}22` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[60vh] w-[80vw] -translate-x-1/2 opacity-70"
          style={{ background: `radial-gradient(ellipse at top, ${LIME}33, transparent 60%)` }}
          aria-hidden
        />

        {/* Centered headline */}
        <div className="relative z-10 mx-auto flex flex-1 max-w-4xl flex-col items-center justify-center text-center animate-fade-up">
          <span
            className="inline-flex items-center gap-2 border-2 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] backdrop-blur"
            style={{ borderColor: LIME, color: LIME, background: "rgba(182,222,72,0.08)" }}
          >
            <Sparkles className="size-3" /> Writing, on autopilot
          </span>

          <h1
            className="mt-6 text-[clamp(2.75rem,11vw,8rem)] font-extrabold leading-[0.95] tracking-tight"
            style={{ color: PAPER }}
          >
            Describe it.
            <br />
            <span style={{ color: LIME }}>Paperstudio writes it.</span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-2xl text-base sm:text-xl"
            style={{ color: "rgba(244,244,239,0.78)" }}
          >
            Chapters, decks, interview transcripts, and survey responses — written in voice by AI, and ready to export or submit, all in one workspace.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={ctaHref}
              className="lime-cta group inline-flex items-center gap-2 border-2 px-6 py-3.5 text-sm font-bold hard-shadow-sm hard-shadow-hover"
              style={{ background: LIME, borderColor: LIME, color: INK }}
            >
              {authed ? "Enter Office" : "Start writing free"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            {!authed && (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 border-2 px-6 py-3.5 text-sm font-bold"
                style={{ borderColor: "rgba(244,244,239,0.5)", color: PAPER }}
              >
                See a demo
              </Link>
            )}
          </div>
        </div>

        {/* Scrolling marquee — bottom of hero */}
        <div className="relative z-10 mt-auto pt-10 md:pt-14">
          <p
            className="mb-3 text-center text-[11px] uppercase tracking-[0.3em]"
            style={{ color: "rgba(244,244,239,0.55)" }}
          >
            Trusted by researchers, founders & students
          </p>
          <div
            className="relative overflow-hidden border-y-2 py-3"
            style={{
              borderColor: "rgba(244,244,239,0.15)",
              maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
              WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            }}
          >
            <div className="flex w-max animate-marquee gap-10 pr-10">
              {[...marqueeItems, ...marqueeItems].map((item, i) => (
                <div
                  key={i}
                  className="flex shrink-0 items-center gap-2 text-sm font-bold uppercase tracking-widest"
                  style={{ color: "rgba(244,244,239,0.75)" }}
                >
                  <item.icon className="size-4" style={{ color: LIME }} />
                  <span>{item.label}</span>
                  <span style={{ color: LIME }}>·</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Light panel below */}
      <section className="bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32 lg:px-8">
          <h2 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            One workspace for everything you write.
          </h2>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Paperstudio writes chapters, decks, interview transcripts, and survey responses in voice — then exports or submits them for you.
          </p>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Feature icon={BarChart3} title="AI-assisted writing" desc="Chapters, reports, and analysis — with your data, sources, and instructions baked in." />
            <Feature icon={Presentation} title="Presentations" desc="Describe the deck you need and get live, editable slides exported to .pptx." />
            <Feature icon={MessageSquareText} title="Interview Studio" desc="Upload a guide and get a full interview transcript per AI respondent." />
            <Feature icon={ClipboardPenLine} title="Survey autofill" desc="Paste a Google Forms link — Paperstudio answers in character and submits." />
          </div>

          <div className="mt-20 rounded-2xl bg-accent p-10 text-center shadow-md shadow-black/5 sm:p-16">
            <h3 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Stop starting from a blank page.</h3>
            <p className="mx-auto mt-3 max-w-md text-sm text-accent-foreground/80 sm:text-base">
              One workspace, every format. Paperstudio does the writing.
            </p>
            <Link
              to={ctaHref}
              className="mt-8 inline-flex items-center gap-2 border-2 border-foreground bg-foreground px-7 py-3.5 text-sm font-bold text-background hard-shadow-sm hard-shadow-hover"
            >
              {authed ? "Office" : "Get started"} <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Link to="/" className="flex items-center gap-2">
                <div
                  className="flex size-8 items-center justify-center border-2 font-extrabold"
                  style={{ background: LIME, borderColor: INK, color: INK }}
                >
                  P
                </div>
                <span className="text-sm font-bold tracking-tight">Paperstudio</span>
              </Link>
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                The writing workspace. Serious work, done.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground">Writing</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground">Presentations</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground">Interview Studio</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground">Survey autofill</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Resources</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to="/" className="text-foreground/80 hover:text-foreground">Pricing</Link></li>
                <li><Link to="/" className="text-foreground/80 hover:text-foreground">Help center</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Company</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to="/" className="text-foreground/80 hover:text-foreground">About</Link></li>
                <li><Link to="/auth" className="text-foreground/80 hover:text-foreground">Sign in</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
            <span>© {new Date().getFullYear()} Paperstudio. All rights reserved.</span>
            <span>A slice of grey.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-md shadow-black/5 transition-shadow hover:shadow-lg hover:shadow-black/10">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
