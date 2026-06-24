import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Upload, Loader2, Sparkles, FileText, Trash2, Download, Plus,
  CheckCircle2, AlertCircle, ArrowLeft, MessageSquareText,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  analyzeInterviewDoc, createInterviewStudy, generateTranscript,
  listInterviewStudies, getInterviewStudy, deleteInterviewStudy,
} from "@/lib/interviews.functions";
import {
  renderTranscript, downloadBlob, downloadAllAsZip,
  type TranscriptFormat, type TranscriptMeta, type Turn,
} from "@/lib/transcript-formats";

export const Route = createFileRoute("/_authenticated/app/interviews")({
  head: () => ({ meta: [{ title: "Interview Studio · Paperstudio" }] }),
  component: InterviewStudio,
});

const FORMATS: { value: TranscriptFormat; label: string }[] = [
  { value: "vtt", label: "VTT (.vtt)" },
  { value: "docx", label: "Word (.docx)" },
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "txt", label: "Plain text (.txt)" },
  { value: "md", label: "Markdown (.md)" },
];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Run async tasks with a concurrency cap, reporting progress as each finishes.
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

function InterviewStudio() {
  const qc = useQueryClient();
  const analyzeFn = useServerFn(analyzeInterviewDoc);
  const createFn = useServerFn(createInterviewStudy);
  const genFn = useServerFn(generateTranscript);
  const listFn = useServerFn(listInterviewStudies);
  const getFn = useServerFn(getInterviewStudy);
  const delFn = useServerFn(deleteInterviewStudy);

  const studiesQ = useQuery({ queryKey: ["interview-studies"], queryFn: () => listFn() });

  type Stage = "intake" | "confirm" | "results";
  const [stage, setStage] = useState<Stage>("intake");

  // Intake
  const [guideFiles, setGuideFiles] = useState<File[]>([]);
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  // Confirm (editable analysis)
  const [title, setTitle] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [mode, setMode] = useState<"teams" | "zoom" | "in_person">("teams");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [contextSummary, setContextSummary] = useState("");
  const [namingContext, setNamingContext] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [countEvidence, setCountEvidence] = useState("");
  const [count, setCount] = useState(12);
  const [guide, setGuide] = useState<{ id: string; text: string }[]>([]);
  const [anonymize, setAnonymize] = useState(false);
  const [depth, setDepth] = useState<"brief" | "standard" | "in_depth">("standard");
  const [creating, setCreating] = useState(false);

  // Results
  const [study, setStudy] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<TranscriptFormat>("docx");
  const [zipping, setZipping] = useState(false);

  function reset() {
    setStage("intake");
    setGuideFiles([]); setContextFiles([]); setNotes(""); setTitle(""); setInterviewer(""); setMode("teams");
    setDateStart(""); setDateEnd(""); setContextSummary(""); setNamingContext("");
    setSourceExcerpt(""); setCountEvidence(""); setCount(12); setGuide([]);
    setAnonymize(false); setDepth("standard"); setStudy(null); setParticipants([]);
    setGenProgress(null);
  }

  async function analyze() {
    if (!guideFiles.length) { toast.error("Upload your interview guide"); return; }
    setAnalyzing(true);
    try {
      const guidePayload = await Promise.all(guideFiles.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const contextPayload = await Promise.all(contextFiles.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const res = await analyzeFn({ data: { guide_files: guidePayload, context_files: contextPayload.length ? contextPayload : undefined, notes: notes.trim() || undefined } });
      setTitle(res.title);
      setContextSummary(res.context_summary);
      setNamingContext(res.naming_context);
      setSourceExcerpt(res.source_excerpt);
      setCountEvidence(res.count_evidence);
      setCount(res.respondent_count);
      setGuide(res.guide_questions);
      setStage("confirm");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read those documents");
    } finally {
      setAnalyzing(false);
    }
  }

  function metaFor(p: any): TranscriptMeta {
    return {
      studyTitle: study?.title ?? title,
      interviewer: study?.interviewer_name ?? interviewer,
      respondent: study?.anonymize ? p.participant_label : p.display_name,
      date: p.interview_date ?? null,
      mode: study?.interview_mode ?? mode,
    };
  }

  async function createAndGenerate() {
    if (!interviewer.trim()) { toast.error("Enter the interviewer's name"); return; }
    if (!guide.length) { toast.error("Need at least one interview question"); return; }
    setCreating(true);
    try {
      const res = await createFn({ data: {
        title: title.trim() || "Untitled study",
        interviewer_name: interviewer.trim(),
        interview_mode: mode,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
        context_summary: contextSummary || undefined,
        naming_context: namingContext || undefined,
        source_excerpt: sourceExcerpt || undefined,
        guide_questions: guide,
        respondent_count: count,
        anonymize,
        depth,
      }});
      setStudy(res.study);
      setParticipants(res.participants);
      setStage("results");
      qc.invalidateQueries({ queryKey: ["interview-studies"] });
      await generateAll(res.participants);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create study");
    } finally {
      setCreating(false);
    }
  }

  async function generateAll(list: any[]) {
    const pending = list.filter((p) => p.status !== "done");
    if (!pending.length) return;
    setGenProgress({ done: 0, total: pending.length });
    let done = 0;
    await runPool(pending, 3, async (p) => {
      try {
        const updated = await genFn({ data: { participant_id: p.id } });
        setParticipants((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      } catch {
        setParticipants((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "error" } : x)));
      } finally {
        done++;
        setGenProgress({ done, total: pending.length });
      }
    });
    setGenProgress(null);
    qc.invalidateQueries({ queryKey: ["interview-studies"] });
    toast.success("Transcripts ready");
  }

  async function openStudy(id: string) {
    try {
      const res = await getFn({ data: { id } });
      setStudy(res.study);
      setParticipants(res.participants);
      setStage("results");
      const pending = (res.participants ?? []).filter((p: any) => p.status !== "done");
      if (pending.length) await generateAll(res.participants);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open study");
    }
  }

  async function downloadOne(p: any) {
    if (!p.turns?.length) { toast.error("This transcript isn't ready yet"); return; }
    try {
      const { blob, filename } = await renderTranscript(p.turns as Turn[], metaFor(p), downloadFormat);
      downloadBlob(blob, filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not render that format");
    }
  }

  async function downloadZip() {
    const ready = participants.filter((p) => p.turns?.length);
    if (!ready.length) { toast.error("No finished transcripts yet"); return; }
    setZipping(true);
    try {
      const items = ready.map((p) => ({ turns: p.turns as Turn[], meta: metaFor(p) }));
      const safe = (study?.title ?? title ?? "study").replace(/[^a-z0-9]+/gi, "_");
      await downloadAllAsZip(items, downloadFormat, `${safe}_transcripts.zip`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the zip");
    } finally {
      setZipping(false);
    }
  }

  const doneCount = participants.filter((p) => p.status === "done").length;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl flex items-center gap-2">
              <MessageSquareText className="size-6 text-primary" /> Interview Studio
            </h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Upload your interview guide and (optionally) your written chapters separately. Paperstudio builds a distinct respondent for each
              interview and writes a full transcript you can download as VTT, Word, PDF, text, or Markdown.
            </p>
          </div>
          {stage !== "intake" && (
            <Button variant="outline" size="sm" onClick={reset}>
              <Plus className="mr-2 size-4" /> New study
            </Button>
          )}
        </div>

        {/* ---------------- Intake ---------------- */}
        {stage === "intake" && (
          <>
            <Card className="p-4 sm:p-6">
              {/* Interview guide — the ONLY source of questions */}
              <Label className="text-base font-semibold">1. Interview guide</Label>
              <p className="text-sm text-muted-foreground mt-1 mb-3">
                The file with your actual interview questions/prompts. These are used verbatim — nothing else here is treated as a question. Accepts PDF, Word (.docx), .txt, and .md.
              </p>
              <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 cursor-pointer hover:bg-muted/30 transition-colors">
                <Upload className="size-6 text-muted-foreground" />
                <span className="text-sm font-medium">Choose your interview guide</span>
                <span className="text-xs text-muted-foreground">or drop it here</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.markdown"
                  className="hidden"
                  onChange={(e) => setGuideFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {guideFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {guideFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 truncate"><FileText className="size-4 text-muted-foreground shrink-0" /> {f.name}</span>
                      <button onClick={() => setGuideFiles(guideFiles.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Background chapters / context — never used as questions */}
              <Label className="text-base font-semibold mt-6 block">2. Written chapters / context (optional)</Label>
              <p className="text-sm text-muted-foreground mt-1 mb-3">
                Methodology, chapters, literature, background. Used only to understand the study and shape realistic respondents — never as interview questions.
              </p>
              <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 cursor-pointer hover:bg-muted/30 transition-colors">
                <Upload className="size-6 text-muted-foreground" />
                <span className="text-sm font-medium">Choose chapters / context</span>
                <span className="text-xs text-muted-foreground">or drop them here</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.markdown"
                  className="hidden"
                  onChange={(e) => setContextFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {contextFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {contextFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 truncate"><FileText className="size-4 text-muted-foreground shrink-0" /> {f.name}</span>
                      <button onClick={() => setContextFiles(contextFiles.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <Label>Notes for the AI (optional)</Label>
                <Textarea
                  rows={2}
                  className="mt-1"
                  placeholder="Anything not in the documents — e.g. 'focus on rural participants', 'sample size is 18', specific naming guidance..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <Button onClick={analyze} disabled={analyzing || !guideFiles.length} size="lg" className="mt-4">
                {analyzing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                {analyzing ? "Reading your documents..." : "Analyze documents"}
              </Button>
            </Card>

            {/* Past studies */}
            {(studiesQ.data ?? []).length > 0 && (
              <div className="mt-8">
                <h2 className="font-semibold mb-3">Your studies</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(studiesQ.data ?? []).map((s: any) => (
                    <Card key={s.id} className="p-4 flex items-start justify-between gap-3">
                      <button className="text-left flex-1 min-w-0" onClick={() => openStudy(s.id)}>
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.participant_count} participants · {s.depth} · {s.status}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.context_summary}</div>
                      </button>
                      <button
                        onClick={async () => { await delFn({ data: { id: s.id } }); qc.invalidateQueries({ queryKey: ["interview-studies"] }); }}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ---------------- Confirm ---------------- */}
        {stage === "confirm" && (
          <Card className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStage("intake")}><ArrowLeft className="size-4" /></Button>
              <h2 className="font-semibold">Review before generating</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Study title</Label>
                <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label>Your name (the interviewer)</Label>
                <Input className="mt-1" placeholder="e.g. Dr. Amara Nwosu" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Interview mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teams">Microsoft Teams</SelectItem>
                    <SelectItem value="zoom">Zoom</SelectItem>
                    <SelectItem value="in_person">In person</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Interviews from</Label>
                <Input type="date" className="mt-1" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
              </div>
              <div>
                <Label>Interviews to</Label>
                <Input type="date" className="mt-1" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Number of respondents</Label>
              <Input type="number" min={1} max={60} className="mt-1 w-32" value={count}
                onChange={(e) => setCount(Math.min(60, Math.max(1, +e.target.value || 1)))} />
              <p className="text-xs text-muted-foreground mt-1.5">
                <span className="font-medium">Detected from your methodology:</span> {countEvidence}
              </p>
            </div>

            <div>
              <Label>Study context (the AI uses this to shape respondents)</Label>
              <Textarea rows={3} className="mt-1" value={contextSummary} onChange={(e) => setContextSummary(e.target.value)} />
            </div>

            <div>
              <Label>Naming guidance</Label>
              <Textarea rows={2} className="mt-1" value={namingContext} onChange={(e) => setNamingContext(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Names are drawn to fit this population, de-duplicated, and kept off a generic-name blocklist.</p>
            </div>

            <div>
              <Label>Interview guide ({guide.length} questions)</Label>
              <div className="mt-1 space-y-2">
                {guide.map((q, i) => (
                  <div key={q.id} className="flex gap-2">
                    <span className="text-sm text-muted-foreground pt-2.5 w-6 shrink-0">{i + 1}.</span>
                    <Textarea
                      rows={1}
                      value={q.text}
                      onChange={(e) => setGuide(guide.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))}
                    />
                    <button onClick={() => setGuide(guide.filter((x) => x.id !== q.id))} className="text-muted-foreground hover:text-destructive pt-2.5">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setGuide([...guide, { id: `q${Date.now()}`, text: "" }])}>
                  <Plus className="mr-2 size-4" /> Add question
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Interview depth</Label>
                <Select value={depth} onValueChange={(v) => setDepth(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="brief">Brief (~12–16 turns)</SelectItem>
                    <SelectItem value="standard">Standard (~22–30 turns)</SelectItem>
                    <SelectItem value="in_depth">In-depth (~36–50 turns)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="cursor-pointer">De-identify participants</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Use codes (P01, P02) as speaker labels instead of names.</p>
                </div>
                <Switch checked={anonymize} onCheckedChange={setAnonymize} />
              </div>
            </div>

            <Button onClick={createAndGenerate} disabled={creating} size="lg">
              {creating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
              {creating ? "Building respondents..." : `Generate ${count} interviews`}
            </Button>
          </Card>
        )}

        {/* ---------------- Results ---------------- */}
        {stage === "results" && study && (
          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-1">
              <Button variant="ghost" size="sm" onClick={() => setStage("intake")}><ArrowLeft className="size-4" /></Button>
              <h2 className="font-semibold">{study.title}</h2>
            </div>
            <p className="text-sm text-muted-foreground ml-10">
              {doneCount} of {participants.length} transcripts ready · interviewer {study.interviewer_name}
            </p>

            {genProgress && (
              <div className="mt-4 flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" />
                Generating transcripts… {genProgress.done}/{genProgress.total}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label>Download format</Label>
                <Select value={downloadFormat} onValueChange={(v) => setDownloadFormat(v as TranscriptFormat)}>
                  <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={downloadZip} disabled={zipping || doneCount === 0}>
                {zipping ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
                Download all as .zip
              </Button>
            </div>

            <div className="mt-5 space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {study.anonymize ? p.participant_label : p.display_name}
                      {!study.anonymize && <span className="text-xs text-muted-foreground font-normal">({p.participant_label})</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[p.persona?.age, p.persona?.gender, p.persona?.role_context].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.status === "done" && <CheckCircle2 className="size-4 text-green-600" />}
                    {p.status === "pending" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                    {p.status === "error" && (
                      <button onClick={() => generateAll([p])} title="Retry" className="text-destructive">
                        <AlertCircle className="size-4" />
                      </button>
                    )}
                    <Button variant="outline" size="sm" disabled={p.status !== "done"} onClick={() => downloadOne(p)}>
                      <Download className="mr-1.5 size-3.5" /> {downloadFormat.toUpperCase()}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
