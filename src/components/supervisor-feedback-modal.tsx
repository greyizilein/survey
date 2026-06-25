import { useState } from "react";
import {
  X, Upload, ChevronLeft, CheckCircle2, Info,
  MessageSquare, PlusCircle, Trash2, StickyNote, Sparkles, Loader2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { parseSupervisorFeedback } from "@/lib/supervisor-feedback.functions";
import { supabase } from "@/integrations/supabase/client";
import { splitStreamError } from "@/lib/stream-error-marker";

interface FeedbackItem {
  id: string;
  type: "comment" | "insertion" | "deletion" | "note";
  comment: string;
  target_excerpt?: string;
  suggested_replacement?: string;
  author?: string;
  selected?: boolean;
  override?: string;
  scope?: "local" | "document";
}

interface Props {
  open: boolean;
  onClose: () => void;
  documentText: string;
  documentTitle?: string;
  onApplied: (revisedContent: string, itemsAppliedCount: number) => void;
}

type Step = "upload" | "confirm" | "applying" | "done";

const TYPE_META: Record<string, { label: string; icon: typeof MessageSquare; color: string; tooltip: string }> = {
  comment: {
    label: "COMMENT",
    icon: MessageSquare,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    tooltip: "An annotation on a specific passage. The AI will find that passage and rewrite, compress, expand, or re-argue it based on the instruction.",
  },
  insertion: {
    label: "INSERTION",
    icon: PlusCircle,
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    tooltip: "New content the reviewer wants added. The AI will insert it at the correct location and integrate it naturally with surrounding text.",
  },
  deletion: {
    label: "DELETION",
    icon: Trash2,
    color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    tooltip: "Content the reviewer wants removed. The AI will find the passage and delete it cleanly, re-joining the surrounding sentences for flow.",
  },
  note: {
    label: "NOTE",
    icon: StickyNote,
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-600",
    tooltip: "A general instruction for the document (e.g. \"tighten the intro\", \"use past tense throughout\"). The AI will apply it document-wide.",
  },
};

function getConfidence(item: FeedbackItem): "high" | "medium" | "low" {
  if (item.target_excerpt && item.target_excerpt.length > 20) return "high";
  if (item.comment.length > 40 || item.suggested_replacement) return "medium";
  return "low";
}

const CONF_META = {
  high: { label: "Clear", color: "text-emerald-600 dark:text-emerald-400", tip: "Specific instruction with an identified passage — the AI can apply this precisely." },
  medium: { label: "Interpreted", color: "text-amber-600 dark:text-amber-500", tip: "Reasonably clear instruction. The AI will apply its best judgment to fulfil the intent." },
  low: { label: "Inferred", color: "text-orange-600 dark:text-orange-400", tip: "Vague instruction. The AI will infer what was most likely meant from context — check the result carefully." },
};

function StepBar({ step }: { step: Step }) {
  const steps = [
    { id: "upload", label: "Upload" },
    { id: "confirm", label: "Review" },
    { id: "applying", label: "Applying" },
  ];
  const idx = { upload: 0, confirm: 1, applying: 2, done: 2 }[step];
  return (
    <div className="flex items-center gap-0 mb-5">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-0">
          <div className={cn("flex items-center gap-1.5 text-[11px] font-bold transition-colors", i <= idx ? "text-foreground" : "text-muted-foreground/50")}>
            <div className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black transition-all",
              i < idx ? "bg-primary text-primary-foreground" : i === idx ? "bg-foreground text-background" : "bg-border text-muted-foreground",
            )}>
              {i < idx ? <CheckCircle2 size={10} /> : i + 1}
            </div>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={cn("flex-1 h-px mx-3 w-8 transition-colors", i < idx ? "bg-primary" : "bg-border")} />}
        </div>
      ))}
    </div>
  );
}

function BookLoader({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div
          className="absolute inset-0 rounded-full border-2 border-primary border-r-transparent animate-spin"
          style={{ animationDuration: "1.4s" }}
        />
        <Loader2 size={18} className="absolute inset-0 m-auto text-primary" />
      </div>
      <p className="text-[13px] font-bold text-foreground">{label}</p>
      <div className="w-full max-w-[200px]">
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

const structTypes = new Set(["comment", "insertion", "deletion"]);

export function SupervisorFeedbackModal({ open, onClose, documentText, documentTitle, onApplied }: Props) {
  const parseFn = useServerFn(parseSupervisorFeedback);
  const [step, setStep] = useState<Step>("upload");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [isDocx, setIsDocx] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [pasted, setPasted] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState("Thinking through each correction…");
  const [appliedCount, setAppliedCount] = useState(0);
  const [appliedResult, setAppliedResult] = useState<{ content: string; count: number } | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep("upload");
    setItems([]);
    setPasted("");
    setApplyProgress(0);
    setAppliedCount(0);
    setAppliedResult(null);
    setIsDocx(false);
    setParseProgress(0);
  };
  const handleClose = () => { reset(); onClose(); };

  const parseAndAdvance = async (input: { plainText?: string; docxBase64?: string; filename?: string }, ramp?: ReturnType<typeof setInterval>) => {
    try {
      const { items: parsed } = await parseFn({ data: input });
      if (!parsed.length) {
        toast.error("No feedback items detected. Try pasting comments below.");
      } else {
        setItems(parsed.map((it) => ({ ...it, selected: true, override: "", scope: "local" as const })));
        setStep("confirm");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse feedback");
    } finally {
      if (ramp) clearInterval(ramp);
      setParsing(false);
      setParseProgress(0);
    }
  };

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    setIsDocx(ext === "docx");
    setParsing(true);
    setParseProgress(10);
    const ramp = setInterval(() => setParseProgress((p) => Math.min(p + 5, 85)), 250);
    try {
      if (ext === "docx") {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        await parseAndAdvance({ docxBase64: btoa(bin), filename: file.name }, ramp);
      } else {
        await parseAndAdvance({ plainText: await file.text() }, ramp);
      }
    } catch (e) {
      clearInterval(ramp);
      setParsing(false);
      setParseProgress(0);
      toast.error(e instanceof Error ? e.message : "Failed to read file");
    }
  };

  const handlePaste = async () => {
    if (!pasted.trim()) return toast.error("Paste some feedback first");
    setIsDocx(false);
    setParsing(true);
    setParseProgress(20);
    const ramp = setInterval(() => setParseProgress((p) => Math.min(p + 5, 85)), 250);
    await parseAndAdvance({ plainText: pasted }, ramp);
  };

  const handleApply = async () => {
    const selected = items.filter((i) => i.selected);
    if (!selected.length) return toast.error("Select at least one item");

    setApplying(true);
    setApplyProgress(5);
    setApplyStatus("Thinking through each correction…");
    setStep("applying");

    const statusMessages = [
      "Thinking through each correction…",
      "Reading the document carefully…",
      "Applying deletions first…",
      "Inserting new content…",
      "Revising marked passages…",
      "Checking voice and flow…",
      "Self-critiquing the edits…",
      "Finalising the document…",
    ];
    let msgIdx = 0;
    const statusInterval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, statusMessages.length - 1);
      setApplyStatus(statusMessages[msgIdx]);
    }, 3500);
    const ramp = setInterval(() => setApplyProgress((p) => {
      if (p < 40) return p + 2;
      if (p < 75) return p + 0.8;
      if (p < 90) return p + 0.2;
      return p;
    }), 400);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("/api/apply-corrections-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          documentTitle: documentTitle ?? "Document",
          documentText,
          feedbackItems: selected.map((s) => ({
            id: s.id,
            type: s.type,
            comment: s.override?.trim() || s.comment,
            target_excerpt: s.target_excerpt,
            suggested_replacement: s.suggested_replacement,
            scope: s.scope,
          })),
        }),
      });
      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        throw new Error(errText || `Server returned ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }

      clearInterval(ramp);
      clearInterval(statusInterval);

      const { text: accText, error: streamError } = splitStreamError(acc);
      if (streamError) throw new Error(streamError);

      setApplyProgress(100);
      setApplyStatus("Done!");

      const logMatch = accText.match(/CORRECTIONS_LOG\s*Applied:\s*([^\n-]*)/);
      const appliedIds = logMatch ? logMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
      const cleaned = accText.replace(/<!--\s*CORRECTIONS_LOG[\s\S]*?-->/g, "").trim();
      const count = appliedIds.length || selected.length;
      setAppliedCount(count);

      await new Promise((r) => setTimeout(r, 600));
      setAppliedResult({ content: cleaned, count });
      setStep("done");
    } catch (e) {
      clearInterval(ramp);
      clearInterval(statusInterval);
      toast.error(e instanceof Error ? e.message : "Revision failed");
      setStep("confirm");
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = items.filter((i) => i.selected).length;

  const renderFeedbackItem = (item: FeedbackItem) => {
    const meta = TYPE_META[item.type] || TYPE_META.note;
    const conf = getConfidence(item);
    const confMeta = CONF_META[conf];
    const Icon = meta.icon;
    return (
      <div key={item.id} className={cn("rounded-xl border p-3.5 transition-all", item.selected ? "border-primary/25 bg-primary/[0.025]" : "border-border bg-secondary/20 opacity-60")}>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={!!item.selected}
            onCheckedChange={(v) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, selected: !!v } : p)))}
            className="mt-0.5 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded cursor-help", meta.color)}>
                    <Icon size={9} />
                    {meta.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px] text-[11px] leading-snug">{meta.tooltip}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("text-[10px] font-semibold cursor-help", confMeta.color)}>{confMeta.label}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px] text-[11px] leading-snug">{confMeta.tip}</TooltipContent>
              </Tooltip>
              {item.author && <span className="text-[10px] text-muted-foreground">— {item.author}</span>}
            </div>
            <p className="text-[13px] font-semibold text-foreground leading-snug">{item.comment}</p>
            {item.target_excerpt && (
              <p className="text-[11px] text-muted-foreground italic mt-2 border-l-2 border-border pl-2.5 line-clamp-2">"{item.target_excerpt}"</p>
            )}
            {item.selected && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <input
                  type="text"
                  placeholder="Override instruction (optional)"
                  value={item.override || ""}
                  onChange={(e) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, override: e.target.value } : p)))}
                  className="w-full px-2.5 py-1.5 border border-border rounded-lg text-[12px] outline-none focus:border-primary bg-background text-foreground placeholder:text-muted-foreground/50"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <select
                      value={item.scope}
                      onChange={(e) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, scope: e.target.value as "local" | "document" } : p)))}
                      className="px-2.5 py-1.5 border border-border rounded-lg text-[12px] outline-none focus:border-primary bg-background text-foreground cursor-pointer"
                    >
                      <option value="local">Fix locally</option>
                      <option value="document">Apply document-wide</option>
                    </select>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[220px] text-[11px] leading-snug">
                    "Fix locally" edits only the targeted passage. "Apply document-wide" treats this as a standing instruction applied consistently across the whole document.
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const fromDoc = items.filter((i) => structTypes.has(i.type));
  const fromAI = items.filter((i) => !structTypes.has(i.type));

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5 bg-foreground/30 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <div className="bg-background border border-border rounded-2xl max-w-[740px] w-full max-h-[90dvh] flex flex-col shadow-2xl">
          <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[15px] font-black text-foreground">Apply reviewer corrections</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[460px]">{documentTitle ?? "Document"}</p>
              </div>
              <button onClick={handleClose} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors ml-2 flex-shrink-0">
                <X size={15} />
              </button>
            </div>
            {step !== "done" && <StepBar step={step} />}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {step === "upload" && (
              parsing ? (
                <BookLoader progress={parseProgress} label="Extracting comments and instructions…" />
              ) : (
                <>
                  <input
                    id="sup-feedback-file"
                    type="file"
                    accept=".docx,.txt,.md,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                  <label htmlFor="sup-feedback-file" className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all group">
                    <Upload size={28} className="text-muted-foreground group-hover:text-primary mx-auto mb-3 transition-colors" />
                    <div className="text-[14px] font-bold text-foreground">Drop feedback file here</div>
                    <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                      <strong>.docx</strong> with tracked changes recommended, or .txt, .md, .csv
                    </p>
                    <div className="flex items-center gap-1.5 justify-center mt-3 text-[11px] text-muted-foreground">
                      <Info size={11} />
                      <span>Comments and instructions are automatically extracted</span>
                    </div>
                  </label>

                  <div className="my-5 flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">or type / paste comments</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"Paste or type reviewer comments here. Examples:\n• Compress this section to 300 words.\n• The methodology needs more justification for the sample size.\n• Insert a discussion of X here."}
                    rows={7}
                    className="w-full px-3.5 py-3 border border-border rounded-xl text-[13px] outline-none focus:border-primary bg-background resize-none text-foreground placeholder:text-muted-foreground/50 leading-relaxed"
                  />
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={handlePaste}
                      disabled={!pasted.trim()}
                      className="px-4 py-2 rounded-xl text-[12px] font-bold bg-foreground text-background hover:opacity-80 disabled:opacity-40 transition-opacity"
                    >
                      Analyse comments →
                    </button>
                  </div>
                </>
              )
            )}

            {step === "confirm" && (
              <>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {isDocx && (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                      From document: {fromDoc.filter((i) => i.type === "comment").length} comment(s) · {fromDoc.filter((i) => i.type === "insertion").length} insertion(s) · {fromDoc.filter((i) => i.type === "deletion").length} deletion(s)
                    </span>
                  )}
                  {fromAI.length > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                      AI inferred: {fromAI.length} note(s)
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[13px] font-bold text-foreground">{selectedCount} of {items.length} corrections selected</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Deselect items you want to skip. Hover badges for explanations.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: true })))} className="text-[11px] font-bold text-primary hover:underline">All</button>
                    <span className="text-muted-foreground text-[11px]">·</span>
                    <button onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: false })))} className="text-[11px] font-bold text-muted-foreground hover:underline">None</button>
                  </div>
                </div>
                {isDocx && fromAI.length > 0 ? (
                  <div className="space-y-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">From your document</p>
                    {fromDoc.map(renderFeedbackItem)}
                    <div className="h-px bg-border my-3" />
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">AI inferred</p>
                    {fromAI.map(renderFeedbackItem)}
                  </div>
                ) : (
                  <div className="space-y-2.5">{items.map(renderFeedbackItem)}</div>
                )}
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-secondary/50 border border-border">
                  <Sparkles size={13} className="text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">How the AI works:</strong> it reads the document carefully, applies each correction surgically, infers the intent behind vague instructions, then self-checks its edits before finishing.
                  </p>
                </div>
              </>
            )}

            {step === "applying" && (
              <div className="flex flex-col items-center justify-center py-10 gap-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-border" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary border-r-transparent animate-spin" style={{ animationDuration: "1.4s" }} />
                  <Sparkles size={20} className="absolute inset-0 m-auto text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-bold text-foreground">{applyStatus}</p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Applying {selectedCount} correction{selectedCount === 1 ? "" : "s"} to "{documentTitle ?? "your document"}"
                  </p>
                </div>
                <div className="w-full max-w-xs">
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-700 ease-out" style={{ width: `${applyProgress}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center mt-1.5">{Math.round(applyProgress)}% — this may take a minute for longer documents</p>
                </div>
                <div className="w-full max-w-xs space-y-1.5 mt-2">
                  {items.filter((i) => i.selected).map((item, idx, arr) => {
                    const threshold = ((idx + 1) / arr.length) * 100;
                    const done = applyProgress >= threshold;
                    const active = !done && applyProgress >= threshold - 100 / arr.length;
                    return (
                      <div key={item.id} className="flex items-center gap-2 text-[11px]">
                        {done ? (
                          <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                        ) : active ? (
                          <Loader2 size={12} className="animate-spin text-primary flex-shrink-0" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-border flex-shrink-0" />
                        )}
                        <span className={cn("truncate", done ? "text-muted-foreground" : "text-foreground")}>{item.comment}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 size={28} className="text-emerald-500" />
                </div>
                <p className="text-[15px] font-black text-foreground">Corrections applied!</p>
                <p className="text-[12px] text-muted-foreground max-w-xs leading-relaxed">
                  {appliedCount} correction{appliedCount === 1 ? "" : "s"} applied to your document. It's been added to the chat as a new message — review it, then continue.
                </p>
              </div>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-border flex items-center justify-between gap-2 flex-shrink-0">
            <div>
              {step === "confirm" && (
                <button onClick={() => setStep("upload")} className="text-[12px] font-bold text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors">
                  <ChevronLeft size={12} /> Back
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (step === "done" && appliedResult) onApplied(appliedResult.content, appliedResult.count);
                  handleClose();
                }}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-muted-foreground hover:bg-secondary transition-colors"
              >
                {step === "done" ? "Close" : "Cancel"}
              </button>
              {step === "confirm" && (
                <button
                  onClick={handleApply}
                  disabled={selectedCount === 0 || applying}
                  className="px-5 py-2 rounded-xl text-[12px] font-bold bg-foreground text-background hover:opacity-80 disabled:opacity-40 transition-opacity inline-flex items-center gap-1.5"
                >
                  <Sparkles size={11} />
                  Apply {selectedCount} correction{selectedCount === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
