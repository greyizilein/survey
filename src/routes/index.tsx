import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardPenLine, Users, Wand2, Sparkles, Globe, Gauge, FileDown, Zap, ShieldCheck, BarChart3, Presentation, Bot, MessageSquareText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/logo";

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

/** Hook to trigger scroll-reveal on any elements with class `reveal` / `reveal-left` / `reveal-scale` inside the ref'd container. */
function useScrollReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll(".reveal, .reveal-left, .reveal-scale");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // stagger siblings within the same parent
            const siblings = Array.from(entry.target.parentElement?.querySelectorAll(".reveal, .reveal-left, .reveal-scale") ?? []);
            const idx = siblings.indexOf(entry.target as Element);
            (entry.target as HTMLElement).style.transitionDelay = `${idx * 80}ms`;
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function Landing() {
  const [authed, setAuthed] = useState(false);
  useScrollReveal();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const ctaHref = authed ? "/app/dashboard" : "/auth";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* HERO */}
      <section className="dark relative flex min-h-[100svh] flex-col overflow-hidden bg-black px-5 pb-6 pt-5 text-white sm:px-8 md:min-h-[84svh]">
        {/* Video background */}
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.45 }}
          src="/hero.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
        />
        {/* Dark base scrim — deepens blacks so text always pops */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.72) 100%)" }}
          aria-hidden
        />
        {/* Lime brand tint — subtle colour cast matching the accent */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 30% 40%, ${LIME}18 0%, transparent 65%)` }}
          aria-hidden
        />
        {/* Edge vignette for depth */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)" }}
          aria-hidden
        />
        {/* Header */}
        <header className="relative z-20 flex items-center justify-between animate-fade-up">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="size-9" />
            <span className="text-sm font-bold tracking-tight text-white">PAPERSTUDIO</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/pricing"
              className="hidden sm:inline-flex border-2 border-white/25 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white transition-colors"
            >
              Pricing
            </Link>
            {!authed && (
              <Link
                to="/auth"
                className="hidden sm:inline-flex border-2 border-white/25 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors"
              >
                Sign in
              </Link>
            )}
            <Link
              to={ctaHref}
              className="lime-cta border-2 border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground hard-shadow-sm hard-shadow-hover"
            >
              {authed ? "Office" : "Get started"}
            </Link>
          </div>
        </header>

        {/* Centered headline — staggered reveal */}
        <div className="relative z-10 mx-auto flex flex-1 max-w-4xl flex-col items-center justify-center text-center">
          <span className="inline-flex items-center gap-2 border-2 border-primary bg-primary/20 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-primary backdrop-blur animate-fade-up animate-scale-in">
            <Sparkles className="size-3" /> Writing, on autopilot
          </span>

          <h1 className="mt-6 text-[clamp(2.75rem,11vw,8rem)] font-extrabold leading-[0.95] tracking-tight text-white animate-fade-up-delay-1">
            Describe it.
            <br />
            <span className="text-primary">Paperstudio writes it.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base text-white/70 sm:text-xl animate-fade-up-delay-2">
            Everything you need to finish your work, in one workspace built around how easy work should be done. Plan, Draft, WRITE. Push.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 animate-fade-up-delay-3">
            <Link
              to={ctaHref}
              className="lime-cta group inline-flex items-center gap-2 border-2 border-primary bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
            >
              {authed ? "Enter Office" : "Start writing free"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            {!authed && (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 border-2 border-white/40 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:border-white"
              >
                See a demo
              </Link>
            )}
          </div>
        </div>

        {/* Marquee */}
        <div className="relative z-10 mt-auto pt-10 md:pt-14 animate-fade-up-delay-4">
          <p className="mb-3 text-center text-[11px] uppercase tracking-[0.3em] text-white/40">
            Loved by 99%
            <br />
            of first time users
          </p>
          <div
            className="relative overflow-hidden py-3"
            style={{
              maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
              WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            }}
          >
            <div className="flex w-max animate-marquee gap-10 pr-10">
              {[...marqueeItems, ...marqueeItems].map((item, i) => (
                <div
                  key={i}
                  className="flex shrink-0 items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/50"
                >
                  <item.icon className="size-4 text-primary" />
                  <span>{item.label}</span>
                  <span className="text-primary">·</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features section */}
      <section className="bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32 lg:px-8">
          <h2 className="reveal max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            One workspace for everything you write.
          </h2>
          <p className="reveal mt-5 max-w-2xl text-base italic text-muted-foreground sm:text-lg">
            "I went from blank page to a 9,000-word draft I was proud of, in just 12 minutes."
            <span className="mt-2 block not-italic uppercase tracking-wide text-muted-foreground/80">One anonymous user</span>
          </p>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Feature icon={BarChart3} title="AI-assisted writing" desc="Chapters, reports, and analysis — with your data, sources, and instructions baked in." />
            <Feature icon={Presentation} title="Presentations" desc="Describe the deck you need and get live, editable slides exported to .pptx." />
            <Feature icon={MessageSquareText} title="Interview Studio" desc="Upload a guide and get a full interview transcript per AI respondent." />
            <Feature icon={ClipboardPenLine} title="Survey autofill" desc="Paste a Google Forms link — Paperstudio answers in character and submits." />
          </div>

          <div className="reveal-scale mt-20 rounded-2xl bg-accent p-10 text-center shadow-md shadow-black/5 sm:p-16">
            <h3 className="text-3xl font-extrabold tracking-tight text-accent-foreground sm:text-4xl">
              Export-Ready
              <br />
              Great First Drafts
            </h3>
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

      {/* Stats strip */}
      <section className="bg-background py-16">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <Stat value="12 min" label="Avg. time to a 12K draft" />
            <Stat value="9,000+" label="Words per session" />
            <Stat value="99%" label="First-time user satisfaction" />
            <Stat value="5 tools" label="One unified workspace" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2 reveal-left">
              <Link to="/" className="flex items-center gap-2">
                <Logo className="size-8" />
                <span className="text-sm font-bold tracking-tight">PAPERSTUDIO</span>
              </Link>
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                Draft anything. Finish everything.
              </p>
            </div>

            <div className="reveal">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground transition-colors">Writing</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground transition-colors">Presentations</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground transition-colors">Interview Studio</Link></li>
                <li><Link to={ctaHref} className="text-foreground/80 hover:text-foreground transition-colors">Survey autofill</Link></li>
              </ul>
            </div>

            <div className="reveal">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Resources</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to="/pricing" className="text-foreground/80 hover:text-foreground transition-colors">Pricing</Link></li>
                <li><Link to="/" className="text-foreground/80 hover:text-foreground transition-colors">Help center</Link></li>
              </ul>
            </div>

            <div className="reveal">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Company</h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link to="/about" className="text-foreground/80 hover:text-foreground transition-colors">About</Link></li>
                <li><Link to="/contact" className="text-foreground/80 hover:text-foreground transition-colors">Contact</Link></li>
                <li><Link to="/auth" className="text-foreground/80 hover:text-foreground transition-colors">Sign in</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-row items-center justify-between gap-3 text-xs uppercase tracking-wide text-muted-foreground">
            <span>© {new Date().getFullYear()} Paperstudio</span>
            <span>A slice of grey</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="reveal-scale rounded-2xl border border-border bg-card p-6 shadow-md shadow-black/5 transition-all duration-300 hover:shadow-lg hover:shadow-black/10 hover:-translate-y-1">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform duration-300 hover:scale-110">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`text-center transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
    >
      <div className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
