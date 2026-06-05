import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { getProject } from "@/lib/projects.functions";
import { parseSurvey } from "@/lib/surveys.functions";
import { listPersonas } from "@/lib/personas.functions";
import { runSimulation, getSimulationResults, generateVtt } from "@/lib/simulations.functions";
import { toast } from "sonner";
import { ChevronLeft, Play, Download, FileDown, Link2, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project · Surveyor" }] }),
  component: ProjectWorkspace,
});

function ProjectWorkspace() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const projFn = useServerFn(getProject);
  const parseFn = useServerFn(parseSurvey);
  const personasFn = useServerFn(listPersonas);
  const runFn = useServerFn(runSimulation);
  const resultsFn = useServerFn(getSimulationResults);
  const vttFn = useServerFn(generateVtt);

  const projQ = useQuery({ queryKey: ["project", id], queryFn: () => projFn({ data: { id } }) });
  const personasQ = useQuery({ queryKey: ["personas"], queryFn: () => personasFn() });

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "url">("text");
  const [raw, setRaw] = useState("");
  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [activeSurvey, setActiveSurvey] = useState<string | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [activeSimId, setActiveSimId] = useState<string | null>(null);

  const resultsQ = useQuery({
    queryKey: ["sim-results", activeSimId],
    queryFn: () => activeSimId ? resultsFn({ data: { simulation_id: activeSimId } }) : Promise.resolve([]),
    enabled: !!activeSimId,
  });

  async function handleParse() {
    if (!title.trim()) { toast.error("Add a title"); return; }
    setParsing(true);
    try {
      const s = await parseFn({ data: {
        project_id: id, title, source_type: sourceType,
        source_url: sourceType === "url" ? url : undefined,
        raw_input: sourceType === "text" ? raw : undefined,
      }});
      toast.success("Survey parsed");
      setTitle(""); setRaw(""); setUrl("");
      qc.invalidateQueries({ queryKey: ["project", id] });
      setActiveSurvey(s.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Parse failed"); }
    finally { setParsing(false); }
  }

  async function handleRun() {
    if (!activeSurvey) { toast.error("Pick a survey"); return; }
    if (selectedPersonas.size === 0) { toast.error("Select personas"); return; }
    setRunning(true);
    setLog([`Starting simulation with ${selectedPersonas.size} personas...`]);
    try {
      const r = await runFn({ data: { survey_id: activeSurvey, persona_ids: Array.from(selectedPersonas) } });
      setLog((l) => [...l, `Completed: ${r.count} responses generated.`]);
      setActiveSimId(r.simulation_id);
      qc.invalidateQueries({ queryKey: ["project", id] });
      toast.success("Simulation complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
      setLog((l) => [...l, `Error: ${e instanceof Error ? e.message : "Failed"}`]);
    } finally { setRunning(false); }
  }

  async function downloadVtt(personaId: string) {
    if (!activeSurvey) return;
    toast.loading("Generating transcript...", { id: "vtt" });
    try {
      const tr = await vttFn({ data: { survey_id: activeSurvey, persona_id: personaId } });
      downloadFile(tr.vtt_content, `interview-${personaId.slice(0, 8)}.vtt`, "text/vtt");
      toast.success("Transcript ready", { id: "vtt" });
    } catch (e) { toast.error("VTT failed", { id: "vtt" }); }
  }

  function exportCsv() {
    if (!resultsQ.data || !activeSurvey) return;
    const proj = projQ.data?.surveys.find((s: any) => s.id === activeSurvey);
    const questions = (proj?.parsed_questions ?? []) as Array<{ id: string; text: string }>;
    const headers = ["persona", "country", "occupation", ...questions.map((q) => q.text)];
    const rows = resultsQ.data.map((r: any) => {
      const ans = new Map((r.answers ?? []).map((a: any) => [a.question_id, a.answer]));
      return [r.personas?.name, r.personas?.country, r.personas?.occupation,
        ...questions.map((q) => String(ans.get(q.id) ?? ""))];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadFile(csv, `responses-${activeSurvey.slice(0, 8)}.csv`, "text/csv");
  }

  const personas = personasQ.data ?? [];
  const surveys = projQ.data?.surveys ?? [];
  const project = projQ.data?.project;

  return (
    <AppShell>
      <div className="p-6 max-w-[1600px] mx-auto">
        <Link to="/app/projects" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
          <ChevronLeft className="size-4" /> All projects
        </Link>
        <h1 className="text-2xl font-semibold mb-1">{project?.name ?? "..."}</h1>
        <p className="text-sm text-muted-foreground mb-6">{project?.description}</p>

        <div className="grid lg:grid-cols-[360px,1fr,360px] gap-4">
          {/* Left: Survey input + persona selection */}
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><FileText className="size-4" /> Add survey</h3>
              <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as any)}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="text">Paste text</TabsTrigger>
                  <TabsTrigger value="url"><Link2 className="size-3 mr-1" /> URL</TabsTrigger>
                </TabsList>
                <TabsContent value="text" className="space-y-2">
                  <Input placeholder="Survey title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <Textarea rows={6} placeholder="Paste raw questions, interview script, or any text..." value={raw} onChange={(e) => setRaw(e.target.value)} />
                </TabsContent>
                <TabsContent value="url" className="space-y-2">
                  <Input placeholder="Survey title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <Input placeholder="https://forms.google.com/..." value={url} onChange={(e) => setUrl(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Works with public Google Forms, Typeform, MS Forms and most public surveys.</p>
                </TabsContent>
              </Tabs>
              <Button onClick={handleParse} disabled={parsing} className="w-full mt-3">
                {parsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-3">Existing surveys</h3>
              {surveys.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> :
                <div className="space-y-1">
                  {surveys.map((s: any) => (
                    <button key={s.id} onClick={() => setActiveSurvey(s.id)}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${activeSurvey === s.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                      <div className="font-medium truncate">{s.title}</div>
                      <div className="text-xs text-muted-foreground">{(s.parsed_questions as any[])?.length ?? 0} questions</div>
                    </button>
                  ))}
                </div>}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Personas ({selectedPersonas.size} selected)</h3>
                <button className="text-xs text-primary hover:underline" onClick={() => {
                  setSelectedPersonas(new Set(personas.length === selectedPersonas.size ? [] : personas.slice(0, 25).map((p: any) => p.id)));
                }}>{selectedPersonas.size > 0 ? "Clear" : "Pick 25"}</button>
              </div>
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {personas.map((p: any) => (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                      <Checkbox checked={selectedPersonas.has(p.id)} onCheckedChange={(v) => {
                        const s = new Set(selectedPersonas);
                        if (v) s.add(p.id); else s.delete(p.id);
                        setSelectedPersonas(s);
                      }} />
                      <span className="text-sm truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto truncate">{p.country}</span>
                    </label>
                  ))}
                  {personas.length === 0 && <Link to="/app/personas" className="block text-xs text-primary hover:underline p-2">Generate personas first →</Link>}
                </div>
              </ScrollArea>
            </Card>
          </div>

          {/* Middle: Simulation log + results */}
          <Card className="p-4 min-h-[500px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Simulation</h3>
              <Button onClick={handleRun} disabled={!activeSurvey || selectedPersonas.size === 0 || running} size="sm">
                <Play className="size-3.5 mr-1.5" /> {running ? "Running..." : "Run"}
              </Button>
            </div>
            {log.length > 0 && (
              <div className="bg-muted/40 rounded p-3 mb-4 font-mono text-xs space-y-1">
                {log.map((l, i) => <div key={i}>› {l}</div>)}
              </div>
            )}
            {resultsQ.data && resultsQ.data.length > 0 ? (
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {resultsQ.data.map((r: any) => (
                    <Card key={r.id} className="p-3 bg-muted/20">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-sm">{r.personas?.name}</div>
                        <Badge variant="outline" className="text-xs">{r.personas?.country}</Badge>
                      </div>
                      <div className="space-y-1.5">
                        {(r.answers ?? []).slice(0, 5).map((a: any, i: number) => (
                          <div key={i} className="text-xs">
                            <span className="text-muted-foreground">{a.question_id}:</span> <span>{String(a.answer).slice(0, 200)}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-16">
                {activeSurvey ? "Select personas and hit Run." : "Add or pick a survey to begin."}
              </div>
            )}
          </Card>

          {/* Right: Export */}
          <Card className="p-4 h-fit">
            <h3 className="font-semibold text-sm mb-3">Export</h3>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={exportCsv} disabled={!resultsQ.data?.length}>
                <FileDown className="size-4 mr-2" /> Download CSV
              </Button>
              <div className="pt-3 border-t">
                <p className="text-xs font-medium mb-2">VTT interview transcripts</p>
                <p className="text-xs text-muted-foreground mb-2">Generate a conversational transcript for any persona.</p>
                <ScrollArea className="max-h-64">
                  <div className="space-y-1">
                    {Array.from(selectedPersonas).map((pid) => {
                      const p: any = personas.find((x: any) => x.id === pid);
                      if (!p) return null;
                      return (
                        <button key={pid} onClick={() => downloadVtt(pid)} disabled={!activeSurvey}
                          className="w-full flex items-center justify-between text-left px-2 py-1.5 text-xs hover:bg-muted rounded disabled:opacity-50">
                          <span className="truncate">{p.name}</span>
                          <Download className="size-3" />
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
              <div className="pt-3 border-t">
                <p className="text-xs font-medium mb-1">Auto-fill external forms</p>
                <p className="text-xs text-muted-foreground mb-2">Download the Surveyor extension to type responses directly into Google/MS Forms.</p>
                <Link to="/app/extension"><Button variant="outline" size="sm" className="w-full">Get extension</Button></Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
