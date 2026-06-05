import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { listPersonas, generatePersonas, deletePersona } from "@/lib/personas.functions";
import { toast } from "sonner";
import { Trash2, Sparkles, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/personas")({
  head: () => ({ meta: [{ title: "Persona Studio · Surveyor" }] }),
  component: PersonaStudio,
});

function PersonaStudio() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPersonas);
  const genFn = useServerFn(generatePersonas);
  const delFn = useServerFn(deletePersona);

  const personasQ = useQuery({ queryKey: ["personas"], queryFn: () => listFn() });
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function generate() {
    if (!brief.trim()) { toast.error("Add a brief"); return; }
    setBusy(true);
    try {
      const r = await genFn({ data: { count, brief } });
      toast.success(`Generated ${r.inserted} personas`);
      qc.invalidateQueries({ queryKey: ["personas"] });
      qc.invalidateQueries({ queryKey: ["personas-count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally { setBusy(false); }
  }

  const filtered = (personasQ.data ?? []).filter((p: any) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return [p.name, p.country, p.city, p.occupation, p.political_sentiment, ...(p.tags ?? [])].some((s) => s?.toLowerCase().includes(f));
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-3xl font-semibold">Persona Studio</h1>
        <p className="text-muted-foreground mt-1">Generate diverse synthetic respondents on demand.</p>

        <Card className="p-6 mt-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Generate personas</h2>
          <div className="grid md:grid-cols-[1fr,140px,auto] gap-3 items-end">
            <div>
              <Label>Brief</Label>
              <Textarea placeholder="e.g. 'Mid-income Ohio voters, mix of tech-skeptic and curious' or '1,000 globally diverse Gen Z students'"
                value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Count (1–50)</Label>
              <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(1, +e.target.value || 1)))} />
            </div>
            <Button onClick={generate} disabled={busy}>{busy ? "Generating..." : "Generate"}</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Batches of up to 50 per run. Run again to add more — your library is cumulative.</p>
        </Card>

        <div className="flex items-center gap-3 mt-8 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input placeholder="Filter by name, country, occupation..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
          </div>
          <span className="text-sm text-muted-foreground">{filtered.length} personas</span>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p: any) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{[p.age, p.gender, p.city, p.country].filter(Boolean).join(" · ")}</div>
                </div>
                <button onClick={async () => {
                  await delFn({ data: { id: p.id } });
                  qc.invalidateQueries({ queryKey: ["personas"] });
                }} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </div>
              <p className="text-sm mt-2 line-clamp-3 text-muted-foreground">{p.bio}</p>
              <div className="flex flex-wrap gap-1 mt-3">
                {p.occupation && <Badge variant="secondary" className="text-xs">{p.occupation}</Badge>}
                {p.political_sentiment && <Badge variant="outline" className="text-xs">{p.political_sentiment}</Badge>}
                {p.language_style && <Badge variant="outline" className="text-xs">{p.language_style}</Badge>}
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="p-12 text-center text-muted-foreground text-sm md:col-span-2 lg:col-span-3">
              No personas yet. Generate your first batch above.
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
