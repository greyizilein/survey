import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  Upload,
  Copy,
  Download,
  Loader2,
  Wand2,
  FileText,
  X,
  CheckCheck,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { extractDocumentText } from "@/lib/document-extract.functions";

export const Route = createFileRoute("/_authenticated/app/humanize")({
  component: HumanizerPage,
});

type Intensity = "light" | "medium";

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function WordCountBadge({ count, target, label }: { count: number; target?: number; label: string }) {
  const delta = target ? count - target : null;
  const over = delta !== null && Math.abs(delta) > target! * 0.03;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-bold tabular-nums", over ? "text-destructive" : "text-primary")}>
        {count.toLocaleString()} words
        {delta !== null && delta !== 0 && (
          <span className="ml-1 font-normal text-muted-foreground">
            ({delta > 0 ? "+" : ""}{delta})
          </span>
        )}
      </span>
    </div>
  );
}

function HumanizerPage() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractDocFn = useServerFn(extractDocumentText);

  const inputWordCount = countWords(inputText);
  const outputWordCount = countWords(outputText);

  const handleFile = useCallback(async (file: File) => {
    setExtracting(true);
    setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] ?? result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await extractDocFn({ data: { name: file.name, data: base64 } });
      setInputText(result.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract document text");
    } finally {
      setExtracting(false);
    }
  }, [extractDocFn]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const humanize = async () => {
    if (!inputText.trim() || loading) return;
    setLoading(true);
    setOutputText("");
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const response = await fetch("/api/humanizer-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: inputText.trim(),
          intensity,
          targetWordCount: inputWordCount,
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || `Request failed (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        // Parse SSE chunks
        const lines = accumulated.split("\n");
        accumulated = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("0:")) {
            try {
              const chunk = JSON.parse(line.slice(2));
              setOutputText(prev => prev + chunk);
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Humanization failed");
    } finally {
      setLoading(false);
    }
  };

  const copyOutput = async () => {
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadOutput = () => {
    const blob = new Blob([outputText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "humanized.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearInput = () => {
    setInputText("");
    setOutputText("");
    setError(null);
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b-2 border-border px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Wand2 className="size-5 text-primary" />
                <h1 className="text-xl font-extrabold uppercase tracking-widest">Humanizer</h1>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Two-model pipeline — restructure then naturalise. Maintains word count and quality.
              </p>
            </div>

            {/* Intensity selector */}
            <div className="shrink-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Intensity</div>
              <div className="flex border-2 border-border">
                {(["light", "medium"] as Intensity[]).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setIntensity(lvl)}
                    className={cn(
                      "px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                      intensity === lvl
                        ? "bg-primary text-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Main split */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Input panel */}
          <div className="flex flex-1 flex-col border-b-2 border-border lg:border-b-0 lg:border-r-2">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Input</span>
                <WordCountBadge count={inputWordCount} label="" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  className="flex items-center gap-1.5 border-2 border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                >
                  {extracting ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  Upload
                </button>
                {inputText && (
                  <button onClick={clearInput} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.docx,.pdf,.doc"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
            </div>

            <div
              className={cn(
                "relative flex-1",
                dragOver && "ring-2 ring-inset ring-primary"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your text here, or drag & drop a document (.txt, .docx, .pdf)..."
                className="h-full w-full resize-none bg-transparent p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80">
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="size-8 text-primary" />
                    <span className="text-sm font-bold uppercase tracking-widest text-primary">Drop to upload</span>
                  </div>
                </div>
              )}
            </div>

            {/* Humanize button */}
            <div className="border-t border-border p-4">
              <button
                onClick={humanize}
                disabled={!inputText.trim() || loading}
                className="flex w-full items-center justify-center gap-2 border-2 border-foreground bg-foreground py-3 text-sm font-bold uppercase tracking-widest text-background transition-all hover:bg-primary hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" /> Humanizing...</>
                ) : (
                  <><Wand2 className="size-4" /> Humanize</>
                )}
              </button>
            </div>
          </div>

          {/* Output panel */}
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Output</span>
                {outputText && (
                  <WordCountBadge count={outputWordCount} target={inputWordCount} label="" />
                )}
              </div>
              {outputText && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyOutput}
                    className="flex items-center gap-1.5 border-2 border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    {copied ? <CheckCheck className="size-3 text-primary" /> : <Copy className="size-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={downloadOutput}
                    className="flex items-center gap-1.5 border-2 border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Download className="size-3" /> Download
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {error && (
                <div className="mb-4 flex items-start gap-2 border-2 border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}

              {loading && !outputText && (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <div>
                      <div className="text-sm font-bold uppercase tracking-widest">Processing</div>
                      <div className="mt-1 text-xs text-muted-foreground">Stage 1: restructuring with Llama 4...</div>
                    </div>
                  </div>
                </div>
              )}

              {!outputText && !loading && !error && (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <Wand2 className="mx-auto size-10 text-muted-foreground/30" />
                    <p className="mt-3 text-sm text-muted-foreground">Humanized output will appear here</p>
                  </div>
                </div>
              )}

              {outputText && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {outputText}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
