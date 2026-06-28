import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileCheck2, Upload, Loader2, FileDown, Menu, X, Sparkles, ClipboardCheck, Copy, Check, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { extractDocumentText } from "@/lib/document-extract.functions";
import { extractFormattingRequirements, gradeWork } from "@/lib/formatting.functions";
import { exportFormattedDocx, exportFormattedPdf, exportFormattedPptx, splitCoverPage, downloadBlob } from "@/lib/writing-export";
import { supabase } from "@/integrations/supabase/client";
import { splitStreamError, splitStreamTruncated } from "@/lib/stream-error-marker";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/formatting")({
  head: () => ({ meta: [{ title: "Formatting · Paperstudio" }] }),
  component: FormattingPage,
});

const STYLE_GUIDES = ["APA", "MLA", "Chicago", "Harvard", "IEEE", "Unspecified"] as const;

type FieldRow = { key: string; label: string; value: string };
type Step = "upload" | "grade" | "review" | "result";
type GradeResult = {
  score: number;
  maxScore: number;
  criteria: { name: string; score: number; max: number; comment: string }[];
  targetWordCountMin: number | null;
  targetWordCountMax: number | null;
  strengths: string[];
  weaknesses: string[];
  missingRequirements: string[];
  verdict: string;
};

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FormattingPage() {
  const extractTextFn = useServerFn(extractDocumentText);
  const extractReqsFn = useServerFn(extractFormattingRequirements);
  const gradeWorkFn = useServerFn(gradeWork);

  const [step, setStep] = useState<Step>("upload");
  const [workFiles, setWorkFiles] = useState<File[]>([]);
  const [briefFiles, setBriefFiles] = useState<File[]>([]);
  const [hasPptxWork, setHasPptxWork] = useState(false);
  const [reading, setReading] = useState(false);
  const [documentText, setDocumentText] = useState("");
  const [briefText, setBriefText] = useState("");

  const [styleGuide, setStyleGuide] = useState<(typeof STYLE_GUIDES)[number]>("APA");
  const [documentType, setDocumentType] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");

  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [enhancing, setEnhancing] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [resultBody, setResultBody] = useState("");
  const [resultCover, setResultCover] = useState<ReturnType<typeof splitCoverPage>["cover"]>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const workInputRef = useRef<HTMLInputElement>(null);
  const briefInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingWork, setIsDraggingWork] = useState(false);
  const [isDraggingBrief, setIsDraggingBrief] = useState(false);
  const workDragCounter = useRef(0);
  const briefDragCounter = useRef(0);

  function addWorkFiles(files: File[]) {
    if (!files.length) return;
    setWorkFiles((prev) => [...prev, ...files]);
  }

  function addBriefFiles(files: File[]) {
    if (!files.length) return;
    setBriefFiles((prev) => [...prev, ...files]);
  }

  async function authToken(): Promise<string> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Not signed in");
    return token;
  }

  async function readFiles(files: File[]): Promise<string> {
    const parts: string[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        const data = await readAsBase64(f);
        const { text } = await extractTextFn({ data: { name: f.name, data } });
        parts.push(`### ${f.name}\n${text}`);
      } catch (e) {
        console.error(`[formatting] could not read "${f.name}":`, e);
        failed.push(f.name);
      }
    }
    if (failed.length) toast.warning(`Couldn't read: ${failed.join(", ")}`);
    if (!parts.length) throw new Error("Could not read any of those documents — try them one at a time to find the bad one.");
    return parts.join("\n\n");
  }

  async function analyze() {
    if (workFiles.length === 0) {
      toast.error("Upload the document you're submitting first");
      return;
    }
    setReading(true);
    try {
      const work = await readFiles(workFiles);
      const brief = briefFiles.length ? await readFiles(briefFiles) : "";
      setDocumentText(work);
      setBriefText(brief);
      setHasPptxWork(workFiles.some((f) => f.name.toLowerCase().endsWith(".pptx")));

      const [reqRes, gradeRes] = await Promise.all([
        extractReqsFn({ data: { documentText: work, briefText: brief || undefined } }),
        gradeWorkFn({ data: { documentText: work, briefText: brief || undefined, currentWordCount: countWords(work) } }),
      ]);
      setStyleGuide(reqRes.styleGuide === "Unspecified" ? "APA" : reqRes.styleGuide);
      setDocumentType(reqRes.documentType);
      setRequirements(reqRes.requirements);
      setFields([
        ...reqRes.detectedFields.map((f) => ({ key: f.key, label: f.label, value: f.value ?? "" })),
        ...reqRes.missingFields.map((f) => ({ key: f.key, label: f.label, value: "" })),
      ]);
      setGrade(gradeRes);
      setStep("grade");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read those documents");
    } finally {
      setReading(false);
    }
  }

  async function enhanceWork() {
    if (!grade) return;
    setEnhancing(true);
    try {
      const token = await authToken();
      const res = await fetch("/api/formatting-enhance-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          documentText,
          briefText: briefText || undefined,
          currentWordCount: countWords(documentText),
          targetWordCountMin: grade.targetWordCountMin,
          targetWordCountMax: grade.targetWordCountMax,
          weaknesses: grade.weaknesses,
          missingRequirements: grade.missingRequirements,
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Enhancing failed"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
      }
      const { text: afterTruncation, truncated } = splitStreamTruncated(full);
      const { text, error } = splitStreamError(afterTruncation);
      if (error) throw new Error(error);
      setDocumentText(text.trim());
      if (truncated) toast.warning("This was cut off due to length — review before formatting, or try again.");
      else toast.success("Work enhanced — review and format it below");
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enhance the work");
    } finally {
      setEnhancing(false);
    }
  }

  function keepAsIs() {
    setStep("review");
  }

  function updateField(i: number, value: string) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, value } : f)));
  }

  async function generate() {
    setGenerating(true);
    setResultBody("");
    setResultCover(null);
    try {
      const token = await authToken();

      const fieldsRecord = Object.fromEntries(fields.filter((f) => f.value.trim()).map((f) => [f.label, f.value.trim()]));

      const res = await fetch("/api/formatting-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          documentText,
          briefText: briefText || undefined,
          styleGuide,
          documentType: documentType || "Document",
          fields: fieldsRecord,
          requirements,
          instructions: instructions || undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Formatting failed"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const { text: noTrunc } = splitStreamTruncated(full);
        const { text } = splitStreamError(noTrunc);
        const { body, cover } = splitCoverPage(text);
        setResultBody(body);
        if (cover) setResultCover(cover);
      }
      const { text: afterTruncation, truncated } = splitStreamTruncated(full);
      const { text, error } = splitStreamError(afterTruncation);
      if (error) throw new Error(error);
      const { body, cover } = splitCoverPage(text);
      setResultBody(body);
      setResultCover(cover);
      setStep("result");
      if (truncated) toast.warning("This response hit the length limit and was cut off — you may want to regenerate.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Formatting failed");
    } finally {
      setGenerating(false);
    }
  }

  function baseFilename() {
    return (resultCover?.title || documentType || "submission").replace(/[^\w\- ]+/g, "").trim() || "submission";
  }

  async function download(format: "docx" | "pdf" | "pptx") {
    setExporting(true);
    try {
      const blob =
        format === "docx" ? await exportFormattedDocx(resultBody, resultCover)
        : format === "pdf" ? await exportFormattedPdf(resultBody, resultCover)
        : await exportFormattedPptx(resultBody, resultCover);
      downloadBlob(blob, `${baseFilename()}.${format}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export document");
    } finally {
      setExporting(false);
    }
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function reset() {
    setStep("upload");
    setWorkFiles([]); setBriefFiles([]); setHasPptxWork(false);
    setDocumentText(""); setBriefText("");
    setFields([]); setRequirements([]); setDocumentType(""); setInstructions("");
    setGrade(null);
    setResultBody(""); setResultCover(null);
  }

  return (
    <AppShell>
      {(openMobileMenu) => (
        <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-5">
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2">
            <button onClick={openMobileMenu} className="md:hidden -ml-1.5 p-1.5 shrink-0 text-muted-foreground" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <FileCheck2 className="size-5 shrink-0 hidden sm:block" /> Formatting
          </h1>
          <p className="text-sm text-muted-foreground -mt-3">
            Upload your finished work (and the brief, if you have it) — this turns it into a submission-ready file: cover page, table of contents, and corrected references, in the required style.
          </p>

          {step === "upload" && (
            <Card className="p-4 sm:p-5 space-y-5">
              <div
                className={cn(
                  "space-y-2 rounded-md border-2 border-dashed p-2 transition-colors",
                  isDraggingWork ? "border-primary bg-primary/5" : "border-transparent",
                )}
                onDragEnter={(e) => {
                  e.preventDefault();
                  workDragCounter.current += 1;
                  setIsDraggingWork(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  e.preventDefault();
                  workDragCounter.current -= 1;
                  if (workDragCounter.current <= 0) {
                    workDragCounter.current = 0;
                    setIsDraggingWork(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  workDragCounter.current = 0;
                  setIsDraggingWork(false);
                  addWorkFiles(Array.from(e.dataTransfer.files ?? []));
                }}
              >
                <Label>Your work (required)</Label>
                <input ref={workInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.markdown" className="hidden"
                  onChange={(e) => addWorkFiles(Array.from(e.target.files ?? []))} />
                <Button
                  variant="outline"
                  onClick={() => workInputRef.current?.click()}
                  className={cn("w-full justify-start gap-2 border-dashed", isDraggingWork && "border-primary bg-primary/5")}
                >
                  <Upload className="size-4" /> {isDraggingWork ? "Drop files here" : "Upload document(s) to submit, or drag and drop"}
                </Button>
                {workFiles.length > 0 && (
                  <ul className="text-sm space-y-1">
                    {workFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between bg-muted rounded px-2 py-1">
                        <span className="truncate">{f.name}</span>
                        <button onClick={() => setWorkFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove">
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div
                className={cn(
                  "space-y-2 rounded-md border-2 border-dashed p-2 transition-colors",
                  isDraggingBrief ? "border-primary bg-primary/5" : "border-transparent",
                )}
                onDragEnter={(e) => {
                  e.preventDefault();
                  briefDragCounter.current += 1;
                  setIsDraggingBrief(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  e.preventDefault();
                  briefDragCounter.current -= 1;
                  if (briefDragCounter.current <= 0) {
                    briefDragCounter.current = 0;
                    setIsDraggingBrief(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  briefDragCounter.current = 0;
                  setIsDraggingBrief(false);
                  addBriefFiles(Array.from(e.dataTransfer.files ?? []));
                }}
              >
                <Label>Brief / requirements (optional, but helps a lot)</Label>
                <input ref={briefInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.markdown" className="hidden"
                  onChange={(e) => addBriefFiles(Array.from(e.target.files ?? []))} />
                <Button
                  variant="outline"
                  onClick={() => briefInputRef.current?.click()}
                  className={cn("w-full justify-start gap-2 border-dashed", isDraggingBrief && "border-primary bg-primary/5")}
                >
                  <Upload className="size-4" /> {isDraggingBrief ? "Drop files here" : "Upload brief / rubric / submission instructions, or drag and drop"}
                </Button>
                {briefFiles.length > 0 && (
                  <ul className="text-sm space-y-1">
                    {briefFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between bg-muted rounded px-2 py-1">
                        <span className="truncate">{f.name}</span>
                        <button onClick={() => setBriefFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove">
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button onClick={analyze} disabled={reading || workFiles.length === 0} className="w-full gap-2">
                {reading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {reading ? "Reading your documents…" : "Check what's needed"}
              </Button>
            </Card>
          )}

          {step === "grade" && grade && (
            <Card className="p-4 sm:p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <ClipboardCheck className="size-4" /> Grade
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {Math.round(grade.score)}<span className="text-sm text-muted-foreground font-normal">/{Math.round(grade.maxScore)}</span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">{grade.verdict}</p>

              {grade.targetWordCountMin != null && grade.targetWordCountMax != null && (
                <div className="text-sm rounded border bg-muted/50 p-2.5">
                  Word count: <span className="font-medium">{countWords(documentText)}</span> (target {grade.targetWordCountMin}–{grade.targetWordCountMax})
                  {countWords(documentText) < grade.targetWordCountMin && <span className="text-amber-600 dark:text-amber-400"> — under target</span>}
                  {countWords(documentText) > grade.targetWordCountMax && <span className="text-amber-600 dark:text-amber-400"> — over target</span>}
                </div>
              )}

              <div className="space-y-2">
                {grade.criteria.map((c, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{Math.round(c.score)}/{Math.round(c.max)}</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{c.comment}</p>
                  </div>
                ))}
              </div>

              {grade.strengths.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Strengths</Label>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                    {grade.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {(grade.weaknesses.length > 0 || grade.missingRequirements.length > 0) && (
                <div className="space-y-1">
                  <Label className="text-xs">To improve</Label>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                    {grade.weaknesses.map((s, i) => <li key={`w${i}`}>{s}</li>)}
                    {grade.missingRequirements.map((s, i) => <li key={`m${i}`}>Missing: {s}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={keepAsIs} disabled={enhancing} className="flex-1">
                  Leave as-is, just format
                </Button>
                <Button onClick={enhanceWork} disabled={enhancing} className="flex-1 gap-2">
                  {enhancing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  {enhancing ? "Enhancing…" : "Enhance first"}
                </Button>
              </div>
            </Card>
          )}

          {step === "review" && (
            <Card className="p-4 sm:p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Style guide</Label>
                  <Select value={styleGuide} onValueChange={(v) => setStyleGuide(v as typeof styleGuide)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STYLE_GUIDES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Document type</Label>
                  <Input value={documentType} onChange={(e) => setDocumentType(e.target.value)} placeholder="e.g. Research proposal" />
                </div>
              </div>

              {requirements.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Detected from the brief</Label>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                    {requirements.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {fields.length > 0 && (
                <div className="space-y-3">
                  <Label>Cover page details</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fields.map((f, i) => (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{f.label}</Label>
                        <Input value={f.value} onChange={(e) => updateField(i, e.target.value)} placeholder={f.label} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Anything else the formatter should know? (optional)</Label>
                <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="e.g. use double spacing, exclude appendix from word count…" />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={reset}>Start over</Button>
                <Button onClick={generate} disabled={generating} className="flex-1 gap-2">
                  {generating ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
                  {generating ? "Formatting…" : "Format document"}
                </Button>
              </div>
            </Card>
          )}

          {(step === "result" || generating) && (
            <Card className="p-4 sm:p-5 space-y-4">
              {resultCover && (
                <div className="rounded border bg-muted/50 p-3 text-sm space-y-1">
                  <div className="font-semibold">{resultCover.title}</div>
                  {resultCover.fields.map((f, i) => (
                    <div key={i} className="text-muted-foreground"><span className="font-medium">{f.label}:</span> {f.value}</div>
                  ))}
                </div>
              )}
              <div className={cn("text-sm whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto border rounded p-3", generating && "opacity-70")}>
                {resultBody || (generating ? "Working…" : "")}
              </div>
              {!generating && (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={reset}>Start another</Button>
                  <Button variant="outline" onClick={copyResult} className="gap-2">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button disabled={exporting} className="flex-1 gap-2">
                        {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                        Download
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => download("docx")}>Word (.docx)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => download("pdf")}>PDF (.pdf)</DropdownMenuItem>
                      {hasPptxWork && <DropdownMenuItem onClick={() => download("pptx")}>PowerPoint (.pptx)</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
