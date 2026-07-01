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
import { runSimulation, getSimulationResults, generateVtt, updateResponseAnswer } from "@/lib/simulations.functions";
import { autoFillForm, isAutofillServiceConfigured } from "@/lib/autofill.functions";
import { toast } from "sonner";
import { ChevronLeft, Play, Download, FileDown, Link2, FileText, PenLine } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/projects/$id")({
  head: () => ({ meta: [{ title: "Project · Paperstudio" }] }),
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
  const updateAnswerFn = useServerFn(updateResponseAnswer);

  const autoFillFn = useServerFn(autoFillForm);
  const autoFillConfiguredFn = useServerFn(isAutofillServiceConfigured);

  const projQ = useQuery({ queryKey: ["project", id], queryFn: () => projFn({ data: { id } }) });
  const personasQ = useQuery({ queryKey: ["personas"], queryFn: () => personasFn() });
  const autoFillConfigQ = useQuery({ queryKey: ["autofill-configured"], queryFn: () => autoFillConfiguredFn() });

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "url">("text");
  const [raw, setRaw] = useState("");
  const [context, setContext] = useState("");
  const [url, setUrl] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerAffiliation, setInterviewerAffiliation] = useState("");
  const [parsing, setParsing] = useState(false);
  const [activeSurvey, setActiveSurvey] = useState<string | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [activeSimId, setActiveSimId] = useState<string | null>(null);
  const [editingAnswer, setEditingAnswer] = useState<{ responseId: string; questionId: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");

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
        context_input: sourceType === "text" ? (context.trim() || undefined) : undefined,
        interviewer_name: interviewerName.trim() || undefined,
        interviewer_affiliation: interviewerAffiliation.trim() || undefined,
      }});
      toast.success("Survey parsed");
      setTitle(""); setRaw(""); setContext(""); setUrl(""); setInterviewerName(""); setInterviewerAffiliation("");
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

  async function saveAnswerEdit() {
    if (!editingAnswer) return;
    try {
      await updateAnswerFn({ data: { response_id: editingAnswer.responseId, question_id: editingAnswer.questionId, answer: editingValue } });
      qc.invalidateQueries({ queryKey: ["sim-results", activeSimId] });
      toast.success("Answer updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save answer");
    } finally {
      setEditingAnswer(null);
    }
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

  async function openAndFill(answers: unknown[]) {
    const survey = surveys.find((s: any) => s.id === activeSurvey);
    const surveyUrl = survey?.source_url;
    if (!surveyUrl) { toast.error("This survey has no link to open"); return; }

    if (autoFillConfigQ.data?.configured) {
      toast.loading("Opening the form in a background browser and filling it...", { id: "autofill" });
      try {
        const result = await autoFillFn({ data: { url: surveyUrl, answers } });
        toast.success(
          result.submitted ? `Done — filled ${result.filled} fields and submitted.` : `Filled ${result.filled} fields, but couldn't find a Submit button.`,
          { id: "autofill" },
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Auto-fill failed", { id: "autofill" });
      }
      return;
    }

    // No automation service configured — open the form so it can be filled by hand.
    window.open(surveyUrl, "_blank");
    toast("Automation service not configured. Opened the form in a new tab — use Download CSV to copy answers in.", { duration: 9000 });
  }

  const personas = personasQ.data ?? [];
  const surveys = projQ.data?.surveys ?? [];
  const project = projQ.data?.project;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
        <Link to="/app/projects" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
          <ChevronLeft className="size-4" /> All projects
        </Link>
        <h1 className="text-2xl font-semibold mb-1">{project?.name ?? "..."}</h1>
        <p className="text-sm text-muted-foreground mb-6">{project?.description}</p>

        <div className="grid gap-4 xl:grid-cols-[360px,minmax(0,1fr),360px]">
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
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Interview guide</Label>
                    <Textarea rows={6} placeholder="Paste only the interview guide — the actual list of questions/prompts to ask." value={raw} onChange={(e) => setRaw(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Every question/prompt here is extracted verbatim and used as-is.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Background chapters / context (optional)</Label>
                    <Textarea rows={6} placeholder="Paste any written chapters, reports, or notes for general context — not questions." value={context} onChange={(e) => setContext(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Summarized and used only to ground generated answers — never treated as questions.</p>
                  </div>
                </TabsContent>
                <TabsContent value="url" className="space-y-2">
                  <Input placeholder="Survey title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <Input placeholder="https://forms.google.com/..." value={url} onChange={(e) => setUrl(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Works with public Google Forms, Typeform, MS Forms and most public surveys.</p>
                </TabsContent>
              </Tabs>
              <div className="mt-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Interview details (optional)</Label>
                <Input placeholder="Interviewer / researcher name" value={interviewerName} onChange={(e) => setInterviewerName(e.target.value)} />
                <Input placeholder="Affiliation (e.g. University of …, MRes programme)" value={interviewerAffiliation} onChange={(e) => setInterviewerAffiliation(e.target.value)} />
                <p className="text-xs text-muted-foreground">Used in the interview transcript's intro. Leave blank and the AI will fill these from your uploaded guide if it can find them.</p>
              </div>
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

            {activeSurvey && (() => {
              const s = surveys.find((sv: any) => sv.id === activeSurvey);
              if (!s) return null;
              if (!s.background_context && !s.interviewer_name && !s.interviewer_affiliation) return null;
              return (
                <Card className="p-4 space-y-3">
                  {(s.interviewer_name || s.interviewer_affiliation) && (
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Interview details</h3>
                      {s.interviewer_name && <p className="text-xs"><span className="text-muted-foreground">Interviewer:</span> {s.interviewer_name}</p>}
                      {s.interviewer_affiliation && <p className="text-xs"><span className="text-muted-foreground">Affiliation:</span> {s.interviewer_affiliation}</p>}
                    </div>
                  )}
                  {s.background_context && (
                    <div>
                      <h3 className="font-semibold text-sm mb-2">Detected background context</h3>
                      <p className="text-xs text-muted-foreground mb-2">
                        Extracted from your upload, separate from the guide's questions. Used to ground generated answers.
                      </p>
                      <ScrollArea className="h-32">
                        <p className="text-xs whitespace-pre-wrap">{s.background_context}</p>
                      </ScrollArea>
                    </div>
                  )}
                </Card>
              );
            })()}

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
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-semibold text-sm">Simulation</h3>
              <Button onClick={handleRun} disabled={!activeSurvey || selectedPersonas.size === 0 || running} size="sm" className="w-full sm:w-auto">
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
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{r.personas?.country}</Badge>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => openAndFill(r.answers ?? [])}>
                            <PenLine className="size-3 mr-1" /> Auto-fill
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {(r.answers ?? []).slice(0, 5).map((a: any, i: number) => {
                          const isEditing = editingAnswer?.responseId === r.id && editingAnswer?.questionId === a.question_id;
                          return (
                            <div key={i} className="text-xs group">
                              <span className="text-muted-foreground">{a.question_id}:</span>{" "}
                              {isEditing ? (
                                <div className="mt-1 flex items-start gap-1.5">
                                  <Textarea
                                    autoFocus
                                    rows={2}
                                    className="text-xs"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                  />
                                  <Button size="sm" className="h-6 px-2 text-xs" onClick={saveAnswerEdit}>Save</Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingAnswer(null)}>Cancel</Button>
                                </div>
                              ) : (
                                <span
                                  className="cursor-pointer hover:underline"
                                  title="Click to edit"
                                  onClick={() => { setEditingAnswer({ responseId: r.id, questionId: a.question_id }); setEditingValue(String(a.answer)); }}
                                >
                                  {String(a.answer).slice(0, 200)}
                                </span>
                              )}
                            </div>
                          );
                        })}
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
                {autoFillConfigQ.data?.configured ? (
                  <p className="text-xs text-muted-foreground">
                    Click <strong className="text-foreground">Auto-fill</strong> on any response — a background
                    browser opens the real form, fills it, and submits it. Nothing to install.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mb-2">
                    Google Forms are submitted directly from the <Link to="/app/fill" className="text-primary hover:underline">Fill a survey</Link> page.
                    For other forms, click <strong className="text-foreground">Auto-fill</strong> to open the form in a new tab and fill it from the downloaded answers.
                  </p>
                )}
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
