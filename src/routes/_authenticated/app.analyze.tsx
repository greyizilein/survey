import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Send, Upload, FileText, Loader2, Trash2, Database, FileStack, ListChecks, Check, Copy, CopyCheck, FileDown, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Bar, BarChart, Line, LineChart, Pie, PieChart, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listAnalyzeProjects, summarizeAnalysisDocuments } from "@/lib/analyze.functions";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseMarkdownLite, blocksToHtml, blocksToPlainText } from "@/lib/markdown-lite";
import { compileWrittenSections, exportToDocx, downloadBlob } from "@/lib/writing-export";

export const Route = createFileRoute("/_authenticated/app/analyze")({
  head: () => ({ meta: [{ title: "Writing · Surveyor" }] }),
  component: AnalyzePage,
});

const PIE_COLORS = ["#84cc16", "#0ea5e9", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

type ChartSpec = { type: "bar" | "line" | "pie"; title: string; data: { name: string; value: number }[] };
type TableSpec = { columns: string[]; rows: (string | number)[][] };
type SourceRef = { title: string; url: string; authors?: string[]; year?: number };
type Msg = { role: "user" | "assistant"; content: string; chart?: ChartSpec | null; table?: TableSpec | null; sources?: SourceRef[] | null };
type InstructionsPreset = "none" | "chapter4-quant" | "chapter4-qual" | "chapter4-mixed" | "other-writing";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const splitLine = (line: string) => line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

const PRESET_LABELS: Record<InstructionsPreset, string> = {
  none: "None",
  "chapter4-quant": "Ch.4 Quant",
  "chapter4-qual": "Ch.4 Qual",
  "chapter4-mixed": "Ch.4 Mixed",
  "other-writing": "Advanced Writing",
};

const PRESET_FULL_LABELS: Record<InstructionsPreset, string> = {
  none: "None",
  "chapter4-quant": "Chapter Four — Quantitative",
  "chapter4-qual": "Chapter Four — Qualitative",
  "chapter4-mixed": "Chapter Four — Mixed Methods",
  "other-writing": "Advanced Writing",
};

const STORAGE_KEY = "analyze-chat-state-v1";

type PersistedState = {
  messages: Msg[];
  instructionsPreset: InstructionsPreset;
  instructions: string;
  docSummary: string;
  sourceTab: "project" | "file";
  projectId: string;
  fileName: string;
  fileRows: Record<string, unknown>[];
};

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, fileRows: [] }));
    } catch {
      // localStorage unavailable or still too large — fail silently, nothing else we can do
    }
  }
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}

function splitMarkers(raw: string): { display: string; chart: ChartSpec | null; table: TableSpec | null; sources: SourceRef[] | null } {
  let chart: ChartSpec | null = null;
  let table: TableSpec | null = null;
  let sources: SourceRef[] | null = null;
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const chartMatch = /^@@CHART@@(.*)$/.exec(line);
    if (chartMatch) {
      try { chart = JSON.parse(chartMatch[1]); } catch { /* still streaming */ }
      continue;
    }
    const tableMatch = /^@@TABLE@@(.*)$/.exec(line);
    if (tableMatch) {
      try { table = JSON.parse(tableMatch[1]); } catch { /* still streaming */ }
      continue;
    }
    const sourcesMatch = /^@@SOURCES@@(.*)$/.exec(line);
    if (sourcesMatch) {
      try { sources = JSON.parse(sourcesMatch[1]); } catch { /* still streaming */ }
      continue;
    }
    kept.push(line);
  }
  return { display: kept.join("\n"), chart, table, sources };
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = parseMarkdownLite(text);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const sizeClass = block.level <= 2 ? "text-sm font-semibold" : "text-sm font-medium";
          return <p key={i} className={cn(sizeClass, "mt-1")}>{renderInline(block.text)}</p>;
        }
        if (block.type === "table") {
          return (
            <div key={i} className="overflow-x-auto bg-background rounded p-2 border">
              <table className="text-xs w-full">
                <thead>
                  <tr>{block.header.map((c, ci) => <th key={ci} className="text-left font-semibold px-2 py-1 border-b">{renderInline(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="px-2 py-1 border-b align-top">{renderInline(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function AnalyzePage() {
  const projectsFn = useServerFn(listAnalyzeProjects);
  const summarizeDocsFn = useServerFn(summarizeAnalysisDocuments);
  const projectsQ = useQuery({ queryKey: ["analyze-projects"], queryFn: () => projectsFn() });

  const initialRef = useRef<Partial<PersistedState> | null>(null);
  if (initialRef.current === null) initialRef.current = loadPersistedState();
  const initial = initialRef.current;

  const [sourceTab, setSourceTab] = useState<"project" | "file">(initial.sourceTab ?? "project");
  const [projectId, setProjectId] = useState<string>(initial.projectId ?? "");
  const [fileName, setFileName] = useState<string>(initial.fileName ?? "");
  const [fileRows, setFileRows] = useState<Record<string, unknown>[]>(initial.fileRows ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSummary, setDocSummary] = useState<string>(initial.docSummary ?? "");
  const [summarizingDocs, setSummarizingDocs] = useState(false);
  const [instructionsPreset, setInstructionsPreset] = useState<InstructionsPreset>(initial.instructionsPreset ?? "none");
  const [instructions, setInstructions] = useState(initial.instructions ?? "");

  const [messages, setMessages] = useState<Msg[]>(initial.messages ?? []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  async function copyMessage(index: number, content: string) {
    const blocks = parseMarkdownLite(content);
    const html = blocksToHtml(blocks);
    const plain = blocksToPlainText(blocks);
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
      } catch {
        toast.error("Couldn't copy to clipboard");
      }
    }
  }

  async function exportDocument() {
    const sections = messages.filter((m) => m.role === "assistant").map((m) => m.content);
    const compiled = compileWrittenSections(sections);
    if (!compiled.trim()) {
      toast.error("No written content to export yet");
      return;
    }
    setExporting(true);
    try {
      const title = PRESET_FULL_LABELS[instructionsPreset] !== "None" ? PRESET_FULL_LABELS[instructionsPreset] : "Written Document";
      const blob = await exportToDocx(compiled, title);
      downloadBlob(blob, `${title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}.docx`);
    } catch {
      toast.error("Couldn't export the document");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    savePersistedState({ messages, instructionsPreset, instructions, docSummary, sourceTab, projectId, fileName, fileRows });
  }, [messages, instructionsPreset, instructions, docSummary, sourceTab, projectId, fileName, fileRows]);

  async function summarizeDocFiles(files: File[]) {
    setDocFiles(files);
    if (!files.length) { setDocSummary(""); return; }
    setSummarizingDocs(true);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const res = await summarizeDocsFn({ data: { files: payload } });
      setDocSummary(res.summary);
      toast.success(`Read ${files.length} document${files.length > 1 ? "s" : ""} for context`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read those documents");
    } finally {
      setSummarizingDocs(false);
    }
  }

  function addDocFiles(newFiles: File[]) {
    summarizeDocFiles([...docFiles, ...newFiles]);
  }

  function removeDocFile(index: number) {
    summarizeDocFiles(docFiles.filter((_, i) => i !== index));
  }

  function clearSource() {
    setProjectId(""); setFileName(""); setFileRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { toast.error("Couldn't read any rows from that file — expecting a CSV with a header row."); return; }
    setFileName(file.name);
    setFileRows(rows);
    toast.success(`Loaded ${rows.length} rows from ${file.name}`);
  }

  function currentSource() {
    if (sourceTab === "project" && projectId) return { type: "project" as const, project_id: projectId };
    if (sourceTab === "file" && fileRows.length) return { type: "file" as const, filename: fileName, rows: fileRows };
    return { type: "none" as const };
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const nextMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/analyze-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          source: currentSource(),
          background: docSummary || undefined,
          instructionsPreset,
          instructions: instructions.trim() || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || "Analysis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { display } = splitMarkers(raw);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: display };
          return copy;
        });
      }

      const { display, chart, table, sources } = splitMarkers(raw);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: display.trim() || "I couldn't generate an answer for that.",
          chart,
          table,
          sources,
        };
        return copy;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Sorry, I couldn't process that — please try again." };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  const sourceLabel = sourceTab === "project"
    ? (projectsQ.data ?? []).find((p: any) => p.id === projectId)?.name
    : fileName;

  const sourceActive = sourceTab === "project" ? !!projectId : !!fileName;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2 shrink-0"><BarChart3 className="size-6" /> Writing</h1>
        <p className="text-sm text-muted-foreground mb-3 shrink-0">Chat with your survey data — ask questions, get charts and tables back.</p>

        <Card className="p-0 flex flex-col flex-1 min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b-2 p-3 shrink-0">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={sourceActive ? "default" : "outline"} size="sm" className="gap-1.5">
                  <Database className="size-3.5" /> {sourceActive ? sourceLabel : "Data source"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <h3 className="font-semibold text-sm mb-3">Data source</h3>
                <Tabs value={sourceTab} onValueChange={(v) => { setSourceTab(v as any); clearSource(); }}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="project">Project</TabsTrigger>
                    <TabsTrigger value="file">Upload file</TabsTrigger>
                  </TabsList>
                  <TabsContent value="project" className="space-y-2 mt-3">
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                      <SelectContent>
                        {(projectsQ.data ?? []).map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Analyzes that project's surveys, responses, and personas.</p>
                  </TabsContent>
                  <TabsContent value="file" className="space-y-2 mt-3">
                    <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                      <Upload className="size-5 text-muted-foreground" />
                      <span className="text-sm font-medium">Choose a CSV file</span>
                      <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    </label>
                    {fileName && (
                      <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 truncate"><FileText className="size-4 text-muted-foreground shrink-0" /> {fileName} ({fileRows.length} rows)</span>
                        <button onClick={clearSource} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">CSV with a header row. Columns are auto-summarized for the AI.</p>
                  </TabsContent>
                </Tabs>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant={docFiles.length > 0 || docSummary.trim() !== "" ? "default" : "outline"} size="sm" className="gap-1.5">
                  <FileStack className="size-3.5" />
                  {docFiles.length > 0 ? `${docFiles.length} doc${docFiles.length > 1 ? "s" : ""}` : docSummary.trim() !== "" ? "Docs restored" : "Background docs"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <h3 className="font-semibold text-sm mb-1">Background documents</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Upload chapters, reports, or methodology so the AI has full context. Summarized once and never used as data to compute statistics from.
                </p>
                <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                  <Upload className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Choose documents</span>
                  <span className="text-xs text-muted-foreground">PDF, Word (.docx), .txt, or .md</span>
                  <input type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown" className="hidden"
                    onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) addDocFiles(fs); }} />
                </label>
                {docFiles.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {docFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 truncate"><FileText className="size-4 text-muted-foreground shrink-0" /> {f.name}</span>
                        <button onClick={() => removeDocFile(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {docFiles.length === 0 && docSummary.trim() !== "" && (
                  <div className="mt-3 flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 truncate text-muted-foreground"><FileText className="size-4 shrink-0" /> Background context restored from a previous session</span>
                    <button onClick={() => setDocSummary("")} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="size-4" /></button>
                  </div>
                )}
                {summarizingDocs && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> Reading documents...</p>
                )}
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant={instructionsPreset !== "none" || instructions.trim() ? "default" : "outline"} size="sm" className="gap-1.5">
                  <ListChecks className="size-3.5" /> {instructionsPreset !== "none" ? PRESET_LABELS[instructionsPreset] : "Instructions"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <Label className="text-sm font-semibold">Writing template</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Built-in structure, formatting, depth, and word-count rules — applied automatically, no upload needed. "Advanced Writing" builds an executable prompt table for any other kind of academic writing from your uploaded documents.
                </p>
                <div className="grid gap-1.5">
                  {(["none", "chapter4-quant", "chapter4-qual", "chapter4-mixed", "other-writing"] as InstructionsPreset[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setInstructionsPreset(p)}
                      className={cn(
                        "flex items-center justify-between rounded border px-3 py-2 text-sm text-left transition-colors",
                        instructionsPreset === p ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/40",
                      )}
                    >
                      {PRESET_FULL_LABELS[p]}
                      {instructionsPreset === p && <Check className="size-3.5" />}
                    </button>
                  ))}
                </div>

                <Label className="text-sm font-semibold mt-4 block">Additional instructions</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Anything extra to steer the AI — a lens to apply, terminology to use, what to prioritize.
                </p>
                <Textarea
                  rows={3}
                  placeholder="e.g. Focus on differences by region."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </PopoverContent>
            </Popover>

            {messages.length > 0 && (
              <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={exportDocument} disabled={exporting}>
                {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} Download document
              </Button>
            )}
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setMessages([])}>
                Clear conversation
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-8">
                <BarChart3 className="size-8 mb-2" />
                <p className="text-sm">
                  {sourceActive ? `Ask anything about "${sourceLabel}" — e.g. "what's the breakdown of answers to question 2?"` : "Pick a data source above, then ask a question."}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "assistant" ? <MarkdownLite text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.chart && m.chart.data?.length > 0 && (
                    <div className="mt-3 bg-background rounded p-2">
                      <p className="text-xs font-medium mb-1">{m.chart.title}</p>
                      <ResponsiveContainer width="100%" height={220}>
                        {m.chart.type === "pie" ? (
                          <PieChart>
                            <Pie data={m.chart.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                              {m.chart.data.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip /><Legend />
                          </PieChart>
                        ) : m.chart.type === "line" ? (
                          <LineChart data={m.chart.data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" /><YAxis /><Tooltip />
                            <Line type="monotone" dataKey="value" stroke="#84cc16" strokeWidth={2} />
                          </LineChart>
                        ) : (
                          <BarChart data={m.chart.data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" /><YAxis /><Tooltip />
                            <Bar dataKey="value" fill="#84cc16" />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  )}
                  {m.table && m.table.rows?.length > 0 && (
                    <div className="mt-3 overflow-x-auto bg-background rounded p-2">
                      <table className="text-xs w-full">
                        <thead><tr>{m.table.columns.map((c, idx) => <th key={idx} className="text-left font-semibold px-2 py-1 border-b">{c}</th>)}</tr></thead>
                        <tbody>
                          {m.table.rows.map((row, ri) => (
                            <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="px-2 py-1 border-b">{String(cell)}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <details className="mt-3 bg-background rounded p-2 border">
                      <summary className="text-xs font-medium cursor-pointer select-none">
                        Verified sources used ({m.sources.length})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {m.sources.map((s, si) => (
                          <li key={si} className="text-xs">
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                              {s.authors?.length ? `${s.authors.join(", ")} ` : ""}{s.year ? `(${s.year}) ` : ""}{s.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {m.role === "assistant" && m.content.trim() !== "" && !(sending && i === messages.length - 1) && (
                    <button
                      onClick={() => copyMessage(i, m.content)}
                      className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedIndex === i ? <><CopyCheck className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && messages[messages.length - 1]?.content === "" && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Thinking...
                </div>
              </div>
            )}
          </div>
          <div className="border-t-2 p-3 flex gap-2 shrink-0">
            <Textarea
              rows={1}
              placeholder="Ask about your data..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="resize-none min-h-0"
            />
            <Button onClick={send} disabled={sending || !input.trim()}>
              <Send className="size-4" />
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
