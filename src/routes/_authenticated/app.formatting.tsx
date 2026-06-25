import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileCheck2, Upload, Loader2, FileDown, Menu, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractDocumentText } from "@/lib/document-extract.functions";
import { extractFormattingRequirements } from "@/lib/formatting.functions";
import { exportFormattedDocx, splitCoverPage, downloadBlob } from "@/lib/writing-export";
import { supabase } from "@/integrations/supabase/client";
import { splitStreamError } from "@/lib/stream-error-marker";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/formatting")({
  head: () => ({ meta: [{ title: "Formatting · Paperstudio" }] }),
  component: FormattingPage,
});

const STYLE_GUIDES = ["APA", "MLA", "Chicago", "Harvard", "IEEE", "Unspecified"] as const;

type FieldRow = { key: string; label: string; value: string };
type Step = "upload" | "review" | "result";

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

  const [step, setStep] = useState<Step>("upload");
  const [workFiles, setWorkFiles] = useState<File[]>([]);
  const [briefFiles, setBriefFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [documentText, setDocumentText] = useState("");
  const [briefText, setBriefText] = useState("");

  const [styleGuide, setStyleGuide] = useState<(typeof STYLE_GUIDES)[number]>("APA");
  const [documentType, setDocumentType] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");

  const [generating, setGenerating] = useState(false);
  const [resultBody, setResultBody] = useState("");
  const [resultCover, setResultCover] = useState<ReturnType<typeof splitCoverPage>["cover"]>(null);
  const [exporting, setExporting] = useState(false);

  const workInputRef = useRef<HTMLInputElement>(null);
  const briefInputRef = useRef<HTMLInputElement>(null);

  async function readFiles(files: File[]): Promise<string> {
    const parts: string[] = [];
    for (const f of files) {
      const data = await readAsBase64(f);
      const { text } = await extractTextFn({ data: { name: f.name, data } });
      parts.push(`### ${f.name}\n${text}`);
    }
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

      const res = await extractReqsFn({ data: { documentText: work, briefText: brief || undefined } });
      setStyleGuide(res.styleGuide === "Unspecified" ? "APA" : res.styleGuide);
      setDocumentType(res.documentType);
      setRequirements(res.requirements);
      setFields([
        ...res.detectedFields.map((f) => ({ key: f.key, label: f.label, value: f.value ?? "" })),
        ...res.missingFields.map((f) => ({ key: f.key, label: f.label, value: "" })),
      ]);
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read those documents");
    } finally {
      setReading(false);
    }
  }

  function updateField(i: number, value: string) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, value } : f)));
  }

  async function generate() {
    setGenerating(true);
    setResultBody("");
    setResultCover(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

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
        const { text } = splitStreamError(full);
        const { body, cover } = splitCoverPage(text);
        setResultBody(body);
        if (cover) setResultCover(cover);
      }
      const { text, error } = splitStreamError(full);
      if (error) throw new Error(error);
      const { body, cover } = splitCoverPage(text);
      setResultBody(body);
      setResultCover(cover);
      setStep("result");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Formatting failed");
    } finally {
      setGenerating(false);
    }
  }

  async function download() {
    setExporting(true);
    try {
      const blob = await exportFormattedDocx(resultBody, resultCover);
      downloadBlob(blob, `${(resultCover?.title || documentType || "submission").replace(/[^\w\- ]+/g, "").trim() || "submission"}.docx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export document");
    } finally {
      setExporting(false);
    }
  }

  function reset() {
    setStep("upload");
    setWorkFiles([]); setBriefFiles([]);
    setDocumentText(""); setBriefText("");
    setFields([]); setRequirements([]); setDocumentType(""); setInstructions("");
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
              <div className="space-y-2">
                <Label>Your work (required)</Label>
                <input ref={workInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.markdown" className="hidden"
                  onChange={(e) => setWorkFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
                <Button variant="outline" onClick={() => workInputRef.current?.click()} className="w-full justify-start gap-2">
                  <Upload className="size-4" /> Upload document(s) to submit
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

              <div className="space-y-2">
                <Label>Brief / requirements (optional, but helps a lot)</Label>
                <input ref={briefInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.markdown" className="hidden"
                  onChange={(e) => setBriefFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
                <Button variant="outline" onClick={() => briefInputRef.current?.click()} className="w-full justify-start gap-2">
                  <Upload className="size-4" /> Upload brief / rubric / submission instructions
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
                <div className="flex gap-2">
                  <Button variant="outline" onClick={reset}>Start another</Button>
                  <Button onClick={download} disabled={exporting} className="flex-1 gap-2">
                    {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                    Download submission-ready .docx
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
