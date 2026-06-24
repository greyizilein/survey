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
import { listPersonas, generatePersonas, deletePersona, listPopulations, createPopulation, deletePopulation } from "@/lib/personas.functions";
import { toast } from "sonner";
import { Trash2, Sparkles, Search, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/personas")({
  head: () => ({ meta: [{ title: "Persona Studio · Paperstudio" }] }),
  component: PersonaStudio,
});

function PersonaStudio() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPersonas);
  const genFn = useServerFn(generatePersonas);
  const delFn = useServerFn(deletePersona);

  const populationsFn = useServerFn(listPopulations);
  const createPopulationFn = useServerFn(createPopulation);
  const deletePopulationFn = useServerFn(deletePopulation);

  const personasQ = useQuery({ queryKey: ["personas"], queryFn: () => listFn() });
  const populationsQ = useQuery({ queryKey: ["populations"], queryFn: () => populationsFn() });
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const [popName, setPopName] = useState("");
  const [popBrief, setPopBrief] = useState("");
  const [popSize, setPopSize] = useState(5000);
  const [popBusy, setPopBusy] = useState(false);

  async function createPop() {
    if (!popName.trim() || !popBrief.trim()) { toast.error("Add a name and a brief"); return; }
    setPopBusy(true);
    try {
      const r = await createPopulationFn({ data: { name: popName.trim(), brief: popBrief.trim(), size: popSize } });
      toast.success(`Created "${popName.trim()}" with ${r.inserted} personas`);
      setPopName("");
      setPopBrief("");
      qc.invalidateQueries({ queryKey: ["populations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create population");
    } finally { setPopBusy(false); }
  }

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
        <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">Persona Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">Generate diverse synthetic respondents on demand.</p>

        <Card className="mt-6 p-4 sm:p-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Users className="size-4 text-primary" /> Populations</h2>
          <p className="text-sm text-muted-foreground mb-3">
            A population is a large, reusable group of personas for a location or audience (e.g. "5,000 adults in Lagos, Nigeria").
            When filling a survey, sample respondents from a population instead of generating new ones each time.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr,1fr,140px,auto] md:items-end">
            <div>
              <Label>Name</Label>
              <Input placeholder="e.g. Lagos adults 2026" value={popName} onChange={(e) => setPopName(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Input placeholder="Mixed-income adults in Lagos, Nigeria" value={popBrief} onChange={(e) => setPopBrief(e.target.value)} />
            </div>
            <div>
              <Label>Size</Label>
              <Input type="number" min={1} max={5000} value={popSize} onChange={(e) => setPopSize(Math.min(5000, Math.max(1, +e.target.value || 1)))} />
            </div>
            <Button onClick={createPop} disabled={popBusy} className="w-full md:w-auto">{popBusy ? "Creating..." : "Create population"}</Button>
          </div>

          {(populationsQ.data ?? []).length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(populationsQ.data ?? []).map((p: any) => (
                <div key={p.id} className="flex items-start justify-between rounded-md border p-3">
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{p.brief}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.persona_count} / {p.target_size} personas</div>
                  </div>
                  <button onClick={async () => {
                    await deletePopulationFn({ data: { id: p.id } });
                    qc.invalidateQueries({ queryKey: ["populations"] });
                  }} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="mt-6 p-4 sm:p-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Generate personas</h2>
          <div className="grid gap-3 md:grid-cols-[1fr,150px,auto] md:items-end">
            <div>
              <Label>Brief</Label>
              <Textarea placeholder="e.g. 'Mid-income Ohio voters, mix of tech-skeptic and curious' or '1,000 globally diverse Gen Z students'"
                value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Count (1–5,000)</Label>
              <Input type="number" min={1} max={5000} value={count} onChange={(e) => setCount(Math.min(5000, Math.max(1, +e.target.value || 1)))} />
            </div>
            <Button onClick={generate} disabled={busy} className="w-full md:w-auto">{busy ? "Generating..." : "Generate"}</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Large runs are inserted in backend chunks. The first 500 most recent personas are shown here for speed.</p>
        </Card>

        <div className="mt-8 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input placeholder="Filter by name, country, occupation..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
          </div>
          <span className="text-sm text-muted-foreground">{filtered.length} personas</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
