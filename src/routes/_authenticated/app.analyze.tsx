import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Send, Upload, FileText, Loader2, Trash2 } from "lucide-react";
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
import { analyzeChat, listAnalyzeProjects } from "@/lib/analyze.functions";

export const Route = createFileRoute("/_authenticated/app/analyze")({
  head: () => ({ meta: [{ title: "Analyze · Surveyor" }] }),
  component: AnalyzePage,
});

const PIE_COLORS = ["#84cc16", "#0ea5e9", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

type ChartSpec = { type: "bar" | "line" | "pie"; title: string; data: { name: string; value: number }[] };
type TableSpec = { columns: string[]; rows: (string | number)[][] };
type Msg = { role: "user" | "assistant"; content: string; chart?: ChartSpec | null; table?: TableSpec | null };

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

function AnalyzePage() {
  const analyzeFn = useServerFn(analyzeChat);
  const projectsFn = useServerFn(listAnalyzeProjects);
  const projectsQ = useQuery({ queryKey: ["analyze-projects"], queryFn: () => projectsFn() });

  const [sourceTab, setSourceTab] = useState<"project" | "file">("project");
  const [projectId, setProjectId] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [fileRows, setFileRows] = useState<Record<string, unknown>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

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
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const res = await analyzeFn({
        data: {
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          source: currentSource(),
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.answer, chart: res.chart, table: res.table }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that — please try again." }]);
    } finally {
      setSending(false);
    }
  }

  const sourceLabel = sourceTab === "project"
    ? (projectsQ.data ?? []).find((p: any) => p.id === projectId)?.name
    : fileName;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><BarChart3 className="size-6" /> Analyze</h1>
        <p className="text-sm text-muted-foreground mb-6">Chat with your survey data — ask questions, get charts and tables back.</p>

        <div className="grid gap-4 lg:grid-cols-[320px,minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="p-4">
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
                  <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 cursor-pointer hover:bg-muted/30 transition-colors">
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
            </Card>

            {messages.length > 0 && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setMessages([])}>
                Clear conversation
              </Button>
            )}
          </div>

          <Card className="p-0 flex flex-col h-[70vh]">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-8">
                  <BarChart3 className="size-8 mb-2" />
                  <p className="text-sm">
                    {sourceLabel ? `Ask anything about "${sourceLabel}" — e.g. "what's the breakdown of answers to question 2?"` : "Pick a project or upload a file, then ask a question."}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
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
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Thinking...
                  </div>
                </div>
              )}
            </div>
            <div className="border-t-2 p-3 flex gap-2">
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
      </div>
    </AppShell>
  );
}
