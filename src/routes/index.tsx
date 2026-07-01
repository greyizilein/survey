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

      {/* Features carousel */}
      <section className="bg-background py-24 sm:py-32 overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <h2 className="reveal max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            One workspace for everything you write.
          </h2>
          <p className="reveal mt-5 max-w-2xl text-base italic text-muted-foreground sm:text-lg">
            "I went from blank page to a 9,000-word draft I was proud of, in just 12 minutes."
            <span className="mt-2 block not-italic uppercase tracking-wide text-muted-foreground/80">One anonymous user</span>
          </p>
        </div>

        {/* Scrollable track — bleeds to edges on mobile */}
        <div
          className="mt-12 flex gap-4 overflow-x-auto px-6 pb-4 lg:px-8 snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        >
          {[
            {
              tag: "Writing",
              title: "AI-assisted writing",
              desc: "Chapters, reports, and analysis — with your data, sources, and instructions baked in. Export to Word in one click.",
              video: "/hero.mp4",
              href: "/app/analyze",
              cta: "Start writing",
            },
            {
              tag: "Presentations",
              title: "Decks, done for you.",
              desc: "Describe the deck you need and get live, editable slides built and exported to .pptx — ready to open in PowerPoint.",
              video: "/feature.mp4",
              href: "/app/presentations",
              cta: "Build a deck",
            },
            {
              tag: "Interview Studio",
              title: "100 transcripts, zero scheduling.",
              desc: "Upload a discussion guide and get a full AI interview transcript per persona — unique voices, real depth, instantly.",
              video: "/6000238-uhd_2160_3840_24fps.mp4",
              href: "/app/agent",
              cta: "Run interviews",
            },
            {
              tag: "Survey autofill",
              title: "Paste a link. Get answers.",
              desc: "Share any Google Forms URL and Paperstudio fills it in character and submits — across thousands of personas.",
              video: "/6000429-uhd_2160_3840_24fps.mp4",
              href: "/app/agent",
              cta: "Try autofill",
            },
          ].map((card) => (
            <Link
              key={card.tag}
              to={ctaHref}
              className="group relative flex-none snap-start overflow-hidden rounded-2xl bg-black"
              style={{ width: "min(80vw, 340px)", minHeight: "480px" }}
            >
              {/* Video background */}
              <video
                className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                style={{ opacity: 0.5 }}
                src={card.video}
                autoPlay muted loop playsInline aria-hidden
              />
              {/* Scrim — heavier at bottom for text legibility */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.15) 100%)" }}
                aria-hidden
              />
              {/* Content */}
              <div className="absolute inset-0 flex flex-col justify-between p-6">
                <span className="inline-flex w-fit items-center rounded-full bg-primary/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary backdrop-blur-sm">
                  {card.tag}
                </span>
                <div>
                  <h3 className="text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    {card.desc}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary transition-gap group-hover:gap-2.5">
                    {card.cta} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Slides + Video section */}
      <SlidesSection ctaHref={ctaHref} />

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

      {/* Cinematic interlude — full-bleed video with quote */}
      <section className="dark relative overflow-hidden" style={{ minHeight: "70vh" }}>
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.4 }}
          src="/6000648-uhd_2160_3840_24fps.mp4"
          autoPlay muted loop playsInline aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.8) 100%)" }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center px-6 py-24 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary">Built for serious writers</p>
          <h2 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
            Writing that used to take days.
            <br />
            <span className="text-primary">Done in 12 minutes.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base text-white/70 sm:text-lg">
            Paperstudio was built for one purpose: to eliminate the blank page. Every tool, every output, every export — designed to finish the work.
          </p>
        </div>
      </section>

      {/* Social proof — video background */}
      <section className="dark relative overflow-hidden bg-black py-24 sm:py-32">
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.25 }}
          src="/6000238-uhd_2160_3840_24fps.mp4"
          autoPlay muted loop playsInline aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 100%)" }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 lg:px-8">
          <p className="reveal text-xs font-bold uppercase tracking-[0.3em] text-primary">What people say</p>
          <h2 className="reveal mt-3 max-w-2xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Trusted by writers who ship.
          </h2>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { quote: "I submitted a 12,000-word dissertation chapter in an afternoon. Paperstudio did the heavy lifting.", name: "Chidinma O.", role: "Postgraduate researcher" },
              { quote: "The Interview Studio is magic. I got 50 transcripts with completely distinct voices in under an hour.", name: "Ravi M.", role: "UX researcher" },
              { quote: "Our team stopped paying for five separate tools. Everything we need is right here.", name: "Sofia L.", role: "Content strategist" },
              { quote: "The survey autofill alone is worth it. Google Forms with 1,000 responses in minutes.", name: "James T.", role: "Market researcher" },
              { quote: "Presentations that used to take half a day — Paperstudio builds them while I drink coffee.", name: "Amara K.", role: "Management consultant" },
              { quote: "The Humaniser is the finishing touch every AI workflow needs. Undetectable every time.", name: "Daniel W.", role: "Freelance copywriter" },
            ].map((t, i) => (
              <div
                key={i}
                className="reveal-scale rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
              >
                <p className="text-sm leading-relaxed text-white/80">&ldquo;{t.quote}&rdquo;</p>
                <div className="mt-4">
                  <p className="text-sm font-bold text-white">{t.name}</p>
                  <p className="text-xs text-white/50">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA — video background */}
      <section className="dark relative overflow-hidden bg-black">
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.35 }}
          src="/6000429-uhd_2160_3840_24fps.mp4"
          autoPlay muted loop playsInline aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 60% 50%, ${LIME}20 0%, rgba(0,0,0,0.75) 70%)` }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto max-w-4xl px-6 py-28 text-center sm:py-36 lg:px-8">
          <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Your next draft is
            <br />
            <span className="text-primary">12 minutes away.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-base text-white/70 sm:text-lg">
            No setup. No templates. Just describe what you need and Paperstudio handles the rest.
          </p>
          <Link
            to={ctaHref}
            className="mt-10 inline-flex items-center gap-2 border-2 border-primary bg-primary px-8 py-4 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-all hover:shadow-lg hover:shadow-primary/30"
          >
            Start writing free <ArrowRight className="size-4" />
          </Link>
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

const slides = [
  {
    tag: "Writing",
    heading: "From prompt to polished draft in minutes.",
    body: "Describe your topic, set the length and tone, and Paperstudio writes a full structured document — complete with sources, analysis, and citations — ready to export.",
  },
  {
    tag: "Presentations",
    heading: "Decks that actually look designed.",
    body: "Tell Paperstudio what story you need to tell. It builds every slide, writes the copy, and exports a .pptx file you can open straight in PowerPoint or Google Slides.",
  },
  {
    tag: "Interview Studio",
    heading: "Hundreds of respondents. Zero scheduling.",
    body: "Upload your discussion guide and Paperstudio creates detailed AI interview transcripts per persona — each with unique, consistent voices and real depth.",
  },
  {
    tag: "Survey autofill",
    heading: "Paste a link. Get answers.",
    body: "Share any Google Forms URL and Paperstudio fills it in character and submits — across thousands of personas, with human-grade variety in every response.",
  },
  {
    tag: "AI Agent",
    heading: "Open-ended tasks. Handled completely.",
    body: "Give the agent a complex brief — a report, a competitor analysis, a literature review — and it reasons, researches, and delivers a complete result without handholding.",
  },
  {
    tag: "Humaniser",
    heading: "AI-written. Undetectably human.",
    body: "Run any Paperstudio output through the Humaniser to strip AI patterns, vary sentence rhythm, and produce text that passes every detector — instantly.",
  },
];

function SlidesSection({ ctaHref }: { ctaHref: string }) {
  const [active, setActive] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-advance every 5 s
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Section label */}
        <p className="reveal text-xs font-bold uppercase tracking-[0.3em] text-primary">How it works</p>
        <h2 className="reveal mt-3 max-w-2xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          Everything, in one workspace.
        </h2>

        {/* Desktop: two-column. Mobile: horizontal scroll carousel */}
        <div className="mt-14 hidden lg:flex lg:flex-row lg:items-stretch lg:gap-12">

          {/* LEFT — accordion list */}
          <div className="flex flex-col justify-between gap-3 lg:w-[46%]">
            {slides.map((slide, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`group relative w-full overflow-hidden border-l-4 py-4 pl-5 pr-4 text-left transition-all duration-300 ${
                  active === i ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                {active === i && (
                  <span
                    key={active}
                    className="absolute bottom-0 left-0 h-[2px] bg-primary"
                    style={{ animation: "slide-progress 5s linear forwards" }}
                  />
                )}
                <span className={`text-[10px] font-bold uppercase tracking-[0.25em] ${active === i ? "text-primary" : "text-muted-foreground"}`}>
                  {slide.tag}
                </span>
                <h3 className={`mt-1 text-base font-extrabold leading-tight tracking-tight transition-colors ${active === i ? "text-foreground" : "text-foreground/50"}`}>
                  {slide.heading}
                </h3>
                {active === i && (
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed animate-fade-up">
                    {slide.body}
                  </p>
                )}
              </button>
            ))}
            <Link
              to={ctaHref}
              className="mt-4 inline-flex w-fit items-center gap-2 border-2 border-primary bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hard-shadow-sm hard-shadow-hover"
            >
              Try it free <ArrowRight className="size-4" />
            </Link>
          </div>

          {/* RIGHT — video */}
          <div className="relative overflow-hidden rounded-2xl bg-black lg:flex-1 min-h-[340px]">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover opacity-80"
              src="/feature.mp4"
              autoPlay muted loop playsInline aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 55%)" }}
              aria-hidden
            />
            <div className="absolute bottom-6 left-6 right-6 z-10">
              <span className="inline-block rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary-foreground">
                {slides[active].tag}
              </span>
              <p className="mt-2 text-lg font-extrabold text-white leading-tight">
                {slides[active].heading}
              </p>
            </div>
            <div className="absolute right-5 top-5 z-10 flex flex-col gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`rounded-full transition-all duration-300 ${active === i ? "h-5 w-2 bg-primary" : "h-2 w-2 bg-white/40 hover:bg-white/70"}`}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Mobile: horizontal snap-scroll cards */}
        <div
          className="mt-10 flex gap-4 overflow-x-auto pb-4 lg:hidden snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch", marginLeft: "-1.5rem", marginRight: "-1.5rem", paddingLeft: "1.5rem", paddingRight: "1.5rem" }}
        >
          {slides.map((slide, i) => (
            <div
              key={i}
              className="relative flex-none snap-start overflow-hidden rounded-2xl bg-black"
              style={{ width: "75vw", minHeight: "400px" }}
            >
              <video
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
                src="/feature.mp4"
                autoPlay muted loop playsInline aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%)" }}
                aria-hidden
              />
              <div className="absolute inset-0 flex flex-col justify-between p-5">
                <span className="inline-flex w-fit items-center rounded-full bg-primary/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary backdrop-blur-sm">
                  {slide.tag}
                </span>
                <div>
                  <h3 className="text-lg font-extrabold leading-tight tracking-tight text-white">
                    {slide.heading}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    {slide.body}
                  </p>
                  <Link
                    to={ctaHref}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary"
                  >
                    Try it free <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
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
