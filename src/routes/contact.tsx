import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Mail, MessageSquare, Building2, Send, Check } from "lucide-react";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Paperstudio" },
      { name: "description", content: "Get in touch with the Paperstudio team for support, enterprise enquiries, or general questions." },
    ],
  }),
  component: ContactPage,
});

const CONTACT_EMAIL = "xeros.opinion@gmail.com";
const LIME = "#b6de48";

const reasons = [
  {
    icon: MessageSquare,
    title: "General support",
    desc: "Questions about your account, a feature, or how something works.",
    subject: "Support request",
  },
  {
    icon: Building2,
    title: "Enterprise",
    desc: "Custom word counts, team seats, dedicated support, and billing.",
    subject: "Enterprise enquiry",
  },
  {
    icon: Mail,
    title: "Everything else",
    desc: "Feedback, partnerships, press, or anything that doesn't fit above.",
    subject: "Hello",
  },
];

function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  function handleReasonClick(s: string) {
    setSubject(s);
    document.getElementById("contact-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !message) return;
    setSending(true);
    // Open mailto as fallback — Resend email sending requires a server function wired in a future iteration
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject || "Contact from Paperstudio")}&body=${body}`;
    // Mark sent after short delay
    setTimeout(() => { setSending(false); setSent(true); }, 800);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="flex items-center justify-between border-b-2 border-border px-6 py-4 sm:px-10">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-sm font-bold tracking-tight uppercase">Paperstudio</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link to="/about" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-foreground/60 hover:text-foreground transition-colors">About</Link>
          <Link to="/pricing" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-foreground/60 hover:text-foreground transition-colors">Pricing</Link>
          <Link to="/contact" className="hidden sm:inline text-xs font-bold uppercase tracking-widest text-primary">Contact</Link>
          <Link to="/auth" className="border-2 border-foreground bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hard-shadow-sm hard-shadow-hover">
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b-2 border-border px-6 py-20 sm:px-10 sm:py-28">
        <div
          className="pointer-events-none absolute left-0 top-0 h-full w-1/2 opacity-25"
          style={{ background: `radial-gradient(ellipse at top left, ${LIME}44, transparent 60%)` }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-5xl">
          <span className="inline-flex items-center gap-2 border-2 border-primary bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-primary">
            Get in touch
          </span>
          <h1 className="mt-6 text-[clamp(3rem,10vw,7rem)] font-extrabold leading-[0.92] tracking-tight">
            We&apos;d love to{" "}
            <span className="text-primary">hear from you.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Support, enterprise, or just a hello — reach us directly at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
              {CONTACT_EMAIL}
            </a>{" "}
            or use the form below.
          </p>
        </div>
      </section>

      {/* Reason cards */}
      <section className="border-b-2 border-border px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">What brings you here?</span>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {reasons.map((r) => (
              <button
                key={r.title}
                onClick={() => handleReasonClick(r.subject)}
                className="group flex flex-col gap-3 border-2 border-border p-6 text-left transition-all hover:border-primary hover:bg-primary/5"
              >
                <r.icon className="size-6 text-primary" />
                <h3 className="text-base font-bold group-hover:text-primary transition-colors">{r.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{r.desc}</p>
                <span className="mt-auto flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Write us <ArrowRight className="size-3" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact-form" className="px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-16 lg:grid-cols-2">
            {/* Left: form */}
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Send a message</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Drop us a line.</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                We reply to every message, usually within one business day.
              </p>

              {sent ? (
                <div className="mt-10 flex flex-col items-start gap-4 border-2 border-primary bg-primary/10 p-8">
                  <div className="flex size-10 items-center justify-center border-2 border-primary bg-primary text-primary-foreground">
                    <Check className="size-5" />
                  </div>
                  <h3 className="text-xl font-bold">Message opened in your email client.</h3>
                  <p className="text-sm text-muted-foreground">
                    Your default mail app should have opened with your message pre-filled. Hit send and we&apos;ll get back to you shortly.
                  </p>
                  <button
                    onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); setSubject(""); }}
                    className="text-xs font-bold uppercase tracking-widest text-primary underline underline-offset-4"
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="name" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Name <span className="text-primary">*</span>
                      </label>
                      <input
                        id="name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="border-2 border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Email <span className="text-primary">*</span>
                      </label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="border-2 border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="subject" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Subject
                    </label>
                    <input
                      id="subject"
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="What's this about?"
                      className="border-2 border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="message" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Message <span className="text-primary">*</span>
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={6}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Tell us what's on your mind…"
                      className="border-2 border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={sending || !name || !email || !message}
                    className="flex w-fit items-center gap-2 border-2 border-primary bg-primary px-6 py-3.5 text-sm font-bold uppercase tracking-widest text-primary-foreground hard-shadow-sm hard-shadow-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? "Opening…" : "Send message"} <Send className="size-4" />
                  </button>
                </form>
              )}
            </div>

            {/* Right: info */}
            <div className="flex flex-col gap-10 lg:pt-16">
              <div className="border-l-4 border-primary pl-6">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Email us directly</span>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="mt-2 block text-xl font-bold text-foreground hover:text-primary transition-colors break-all"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>

              <div className="border-l-4 border-border pl-6">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Response time</span>
                <p className="mt-2 text-base font-bold">Within 1 business day</p>
                <p className="mt-1 text-sm text-muted-foreground">We read every message personally.</p>
              </div>

              <div className="border-l-4 border-border pl-6">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Enterprise</span>
                <p className="mt-2 text-base font-bold">Custom plans available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Need custom word counts, team seats, or a dedicated account manager?{" "}
                  <Link to="/pricing" className="text-primary underline underline-offset-4">
                    See enterprise pricing
                  </Link>{" "}
                  or email us with your requirements.
                </p>
              </div>

              <div className="border-2 border-border bg-accent/5 p-6">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Already a user?</span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Sign in to your account for faster support — we can look up your account details directly.
                </p>
                <Link
                  to="/auth"
                  className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"
                >
                  Sign in <ArrowRight className="size-3" />
                </Link>
              </div>
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
