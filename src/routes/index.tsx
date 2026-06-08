import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Users, FileDown, Globe } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Surveyor — Synthetic respondents for real research" },
      { name: "description", content: "Generate thousands of diverse synthetic personas, fill surveys, and export VTT interview transcripts in seconds." },
      { property: "og:title", content: "Surveyor" },
      { property: "og:description", content: "Synthetic respondents for real research." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">S</div>
            <span className="font-semibold tracking-tight">Surveyor</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/auth">Sign in</Link></Button>
            <Button asChild size="sm"><Link to="/auth">Get started</Link></Button>
          </div>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-medium mb-6">
          <Sparkles className="size-3" /> Powered by Lovable AI
        </div>
        <h1 className="text-5xl md:text-6xl font-semibold tracking-tighter">
          Synthetic respondents,<br />for real research.
        </h1>
        <p className="text-lg text-muted-foreground mt-6 max-w-2xl mx-auto">
          Generate thousands of distinct personas. Paste any survey. Get authentic, human-feeling answers — plus CSVs, VTT transcripts, and a browser extension that fills live forms for you.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link to="/auth"><Button size="lg">Start free <ArrowRight className="size-4 ml-1" /></Button></Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid md:grid-cols-4 gap-4">
        <Feature icon={Users} title="5,000+ personas" desc="LLM-generated, demographically rich, opinionated." />
        <Feature icon={Globe} title="Parse any survey" desc="Paste text or drop a Google/MS Forms URL." />
        <Feature icon={Sparkles} title="Authentic voice" desc="Each persona answers in their own register." />
        <Feature icon={FileDown} title="VTT + CSV export" desc="Realistic interview transcripts on demand." />
      </section>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="p-5 rounded-xl border bg-card">
      <Icon className="size-5 text-primary" />
      <h3 className="font-medium mt-3">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}
