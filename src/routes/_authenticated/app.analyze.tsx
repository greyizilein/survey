import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Send,
  Upload,
  FileText,
  Loader2,
  Trash2,
  RefreshCw,
  Database,
  FileStack,
  ListChecks,
  Check,
  Copy,
  CopyCheck,
  FileDown,
  MoreHorizontal,
  ClipboardCheck,
  Square,
  Menu,
  Sparkles,
  X,
  Paperclip,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toast } from "sonner";
import { splitStreamError } from "@/lib/stream-error-marker";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listAnalyzeProjects, summarizeAnalysisDocuments } from "@/lib/analyze.functions";
import { extractDocumentText } from "@/lib/document-extract.functions";
import { generateFigureImage } from "@/lib/image-gen.server";
import {
  saveChatConversation,
  getChatConversation,
  listChatConversations,
} from "@/lib/chat-history.functions";
import { getFolderContext } from "@/lib/folders.functions";
import { ChatHistoryMenu } from "@/components/chat-history-menu";
import { FolderBadge } from "@/components/folder-badge";
import { IngestBadge, ingestIconClass, type IngestStatus } from "@/components/ingest-status";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  parseMarkdownLite,
  blocksToHtml,
  blocksToPlainText,
  splitInlineRuns,
} from "@/lib/markdown-lite";
import { compileWrittenSections, exportToDocx, downloadBlob } from "@/lib/writing-export";
import { useAutosizeTextarea } from "@/lib/use-autosize-textarea";
import { SupervisorFeedbackModal } from "@/components/supervisor-feedback-modal";
import { useModelTier } from "@/lib/use-model-tier";
import { Logo } from "@/components/logo";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/_authenticated/app/analyze")({
  head: () => ({ meta: [{ title: "Writing · Paperstudio" }] }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { corrections?: string; folder?: string; chat?: string } => ({
    corrections: typeof s.corrections === "string" ? s.corrections : undefined,
    folder: typeof s.folder === "string" ? s.folder : undefined,
    chat: typeof s.chat === "string" ? s.chat : undefined,
  }),
  component: AnalyzePage,
});

const PIE_COLORS = [
  "#84cc16",
  "#0ea5e9",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#ef4444",
];

type ChartSpec = {
  type: "bar" | "line" | "pie";
  title: string;
  data: { name: string; value: number }[];
};
type TableSpec = { columns: string[]; rows: (string | number)[][] };
type SourceRef = { title: string; url: string; authors?: string[]; year?: number };
type FigureRequest = { prompt: string; caption?: string };
type FigureImage = { caption?: string; base64: string; mediaType: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec | null;
  table?: TableSpec | null;
  sources?: SourceRef[] | null;
  chartImage?: string | null;
  figures?: FigureImage[] | null;
  generatingFigures?: boolean;
  options?: string[] | null;
};
type InstructionsPreset =
  | "chapter4-quant"
  | "chapter4-qual"
  | "chapter4-mixed"
  | "other-writing"
  | "basic-academia"
  | "dissertations";

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
  const splitLine = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

const PRESET_LABELS: Record<InstructionsPreset, string> = {
  "chapter4-quant": "Ch.4 Quant",
  "chapter4-qual": "Ch.4 Qual",
  "chapter4-mixed": "Ch.4 Mixed",
  "other-writing": "Advanced Writing",
  "basic-academia": "Basic Academia",
  dissertations: "Dissertations",
};

const PRESET_FULL_LABELS: Record<InstructionsPreset, string> = {
  "chapter4-quant": "Data Analysis (Quantitative)",
  "chapter4-qual": "Data Analysis (Qualitative)",
  "chapter4-mixed": "Data Analysis (Mixed-Methods)",
  "other-writing": "Advanced Writing",
  "basic-academia": "Basic Academia",
  dissertations: "Dissertations",
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
  return splitInlineRuns(text).map((run, i) => {
    if (run.bold) return <strong key={i}>{run.text}</strong>;
    if (run.italic) return <em key={i}>{run.text}</em>;
    return <span key={i}>{run.text}</span>;
  });
}

/**
 * Some models occasionally narrate a fake tool-call transcript as plain text instead of
 * actually invoking the real tool (e.g. `<tool_call>{...}</tool_call>` / `<tool_response>...`).
 * Strip any such pseudo-XML before it ever reaches the renderer.
 */
function stripFakeToolSyntax(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "")
    .replace(/<\/?tool_call>/gi, "")
    .replace(/<\/?tool_response>/gi, "");
}

function splitMarkers(raw: string): {
  display: string;
  chart: ChartSpec | null;
  table: TableSpec | null;
  sources: SourceRef[] | null;
  chartImage: string | null;
  figureRequests: FigureRequest[];
  options: string[] | null;
} {
  let chart: ChartSpec | null = null;
  let table: TableSpec | null = null;
  let sources: SourceRef[] | null = null;
  let chartImage: string | null = null;
  let options: string[] | null = null;
  const figureRequests: FigureRequest[] = [];
  const cleaned = stripFakeToolSyntax(raw);
  const lines = cleaned.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const chartMatch = /^@@CHART@@(.*)$/.exec(line);
    if (chartMatch) {
      try {
        chart = JSON.parse(chartMatch[1]);
      } catch {
        /* still streaming */
      }
      continue;
    }
    const chartImageMatch = /^@@CHARTIMAGE@@(.*)$/.exec(line);
    if (chartImageMatch) {
      chartImage = chartImageMatch[1].trim() || null;
      continue;
    }
    const tableMatch = /^@@TABLE@@(.*)$/.exec(line);
    if (tableMatch) {
      try {
        table = JSON.parse(tableMatch[1]);
      } catch {
        /* still streaming */
      }
      continue;
    }
    const sourcesMatch = /^@@SOURCES@@(.*)$/.exec(line);
    if (sourcesMatch) {
      try {
        sources = JSON.parse(sourcesMatch[1]);
      } catch {
        /* still streaming */
      }
      continue;
    }
    const figureMatch = /^@@FIGURE@@(.*)$/.exec(line);
    if (figureMatch) {
      try {
        const parsed = JSON.parse(figureMatch[1]);
        if (parsed?.prompt) figureRequests.push({ prompt: parsed.prompt, caption: parsed.caption });
      } catch {
        /* still streaming */
      }
      continue;
    }
    const optionsMatch = /^@@OPTIONS@@(.*)$/.exec(line);
    if (optionsMatch) {
      try {
        const parsed = JSON.parse(optionsMatch[1]);
        if (Array.isArray(parsed?.options))
          options = parsed.options.map((o: unknown) => String(o)).slice(0, 8);
      } catch {
        /* still streaming */
      }
      continue;
    }
    kept.push(line);
  }
  return { display: kept.join("\n"), chart, table, sources, chartImage, figureRequests, options };
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = parseMarkdownLite(text);
  return (
    <div className="space-y-2 min-w-0 max-w-full">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const sizeClass = block.level <= 2 ? "text-sm font-semibold" : "text-sm font-medium";
          return (
            <p key={i} className={cn(sizeClass, "mt-1 break-words")}>
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === "table") {
          return (
            <div
              key={i}
              className="overflow-x-auto bg-background rounded p-2 border min-w-0 max-w-full"
            >
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    {block.header.map((c, ci) => (
                      <th key={ci} className="text-left font-semibold px-2 py-1 border-b">
                        {renderInline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 border-b align-top">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function AnalyzePage() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectsFn = useServerFn(listAnalyzeProjects);
  const summarizeDocsFn = useServerFn(summarizeAnalysisDocuments);
  const extractDocTextFn = useServerFn(extractDocumentText);
  const generateFigureImageFn = useServerFn(generateFigureImage);
  const saveConversationFn = useServerFn(saveChatConversation);
  const getConversationFn = useServerFn(getChatConversation);
  const listConversationsFn = useServerFn(listChatConversations);
  const folderContextFn = useServerFn(getFolderContext);
  const search = Route.useSearch();
  const projectsQ = useQuery({ queryKey: ["analyze-projects"], queryFn: () => projectsFn() });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(search.folder ?? null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderContext, setFolderContext] = useState<string>("");

  const initialRef = useRef<Partial<PersistedState> | null>(null);
  if (initialRef.current === null) initialRef.current = loadPersistedState();
  const initial = initialRef.current;

  const [sourceTab, setSourceTab] = useState<"project" | "file">(initial.sourceTab ?? "project");
  const [projectId, setProjectId] = useState<string>(initial.projectId ?? "");
  const [fileName, setFileName] = useState<string>(initial.fileName ?? "");
  const [fileRows, setFileRows] = useState<Record<string, unknown>[]>(initial.fileRows ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSummary, setDocSummary] = useState<string>(initial.docSummary ?? "");
  const [summarizingDocs, setSummarizingDocs] = useState(false);
  const [failedDocs, setFailedDocs] = useState<string[]>([]);
  const [instructionsPreset, setInstructionsPreset] = useState<InstructionsPreset>(
    initial.instructionsPreset && initial.instructionsPreset in PRESET_LABELS
      ? initial.instructionsPreset
      : "basic-academia",
  );
  const [instructions, setInstructions] = useState(initial.instructions ?? "");
  const [modelTier] = useModelTier();
  // Manual prompt-builder flow — triggered by the toolbar's "Create Prompt"/"Meta Prompt"
  // buttons, never offered automatically.
  const [promptMode, setPromptMode] = useState(false);
  const [promptExecuted, setPromptExecuted] = useState(false);
  const [presetTouched, setPresetTouched] = useState(false);

  const [messages, setMessages] = useState<Msg[]>(initial.messages ?? []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useAutosizeTextarea(textareaRef, input);

  function stopGenerating() {
    abortRef.current?.abort();
  }

  // Title derived from the document's OWN content — never the template/preset name, which
  // would otherwise be stamped at the top of the user's downloaded work (a leak).
  function deriveDocTitle(content: string): string {
    const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading.replace(/[*_`]/g, "").slice(0, 80);
    const firstLine = content
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean);
    return (firstLine?.replace(/[*_#`>]/g, "").trim() || "Document").slice(0, 80);
  }

  function fileNameFor(content: string): string {
    const base = deriveDocTitle(content)
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "");
    return `${base || "Document"}.docx`;
  }

  function documentTitle() {
    return deriveDocTitle(documentText());
  }

  function documentText() {
    const sections = messages.filter((m) => m.role === "assistant").map((m) => m.content);
    return compileWrittenSections(sections);
  }

  function handleCorrectionsApplied(revisedContent: string, itemsAppliedCount: number) {
    setMessages((prev) => [...prev, { role: "assistant", content: revisedContent }]);
    toast.success(
      `Applied ${itemsAppliedCount} correction${itemsAppliedCount === 1 ? "" : "s"} to the document`,
    );
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

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

  async function downloadMessage(index: number, content: string) {
    setDownloadingIndex(index);
    try {
      const blob = await exportToDocx(content);
      downloadBlob(blob, fileNameFor(content));
    } catch {
      toast.error("Couldn't download that message");
    } finally {
      setDownloadingIndex(null);
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
      const blob = await exportToDocx(compiled);
      downloadBlob(blob, fileNameFor(compiled));
    } catch {
      toast.error("Couldn't export the document");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    savePersistedState({
      messages,
      instructionsPreset,
      instructions,
      docSummary,
      sourceTab,
      projectId,
      fileName,
      fileRows,
    });
  }, [
    messages,
    instructionsPreset,
    instructions,
    docSummary,
    sourceTab,
    projectId,
    fileName,
    fileRows,
  ]);

  useEffect(() => {
    if (messages.length === 0) return;
    const handle = setTimeout(() => {
      const firstUserMsg = messages.find((m) => m.role === "user")?.content ?? "New chat";
      const title = firstUserMsg.slice(0, 80);
      saveConversationFn({
        data: {
          id: conversationId ?? undefined,
          tool: "analyze",
          title,
          state: {
            messages,
            instructionsPreset,
            instructions,
            docSummary,
            sourceTab,
            projectId,
            fileName,
            fileRows,
          },
          folderId: conversationId ? undefined : folderId,
        },
      })
        .then(({ id }: { id: string }) => {
          if (!conversationId) setConversationId(id);
        })
        .catch((err) => {
          console.error("[chat-history] save failed:", err);
          toast.error(
            `Couldn't save chat history: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        });
    }, 1000);
    return () => clearTimeout(handle);
  }, [
    messages,
    instructionsPreset,
    instructions,
    docSummary,
    sourceTab,
    projectId,
    fileName,
    fileRows,
    conversationId,
    folderId,
    saveConversationFn,
  ]);

  function handleNewChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setSourceTab("project");
    setProjectId("");
    setFileName("");
    setFileRows([]);
    setDocFiles([]);
    setDocSummary("");
    setInstructionsPreset("basic-academia");
    setInstructions("");
    setPromptMode(false);
    setPromptExecuted(false);
    setPresetTouched(false);
  }

  async function handleSelectConversation(id: string): Promise<Msg[] | null> {
    try {
      const { conversation } = await getConversationFn({ data: { id } });
      const state = (conversation.state ?? {}) as Partial<PersistedState>;
      const loadedMessages = state.messages ?? [];
      setConversationId(conversation.id);
      setMessages(loadedMessages);
      setInstructionsPreset(
        state.instructionsPreset && state.instructionsPreset in PRESET_LABELS
          ? state.instructionsPreset
          : "basic-academia",
      );
      setInstructions(state.instructions ?? "");
      setDocSummary(state.docSummary ?? "");
      setSourceTab(state.sourceTab ?? "project");
      setProjectId(state.projectId ?? "");
      setFileName(state.fileName ?? "");
      setFileRows(state.fileRows ?? []);
      setDocFiles([]);
      setFolderId(conversation.folder_id ?? null);
      setPromptMode(false);
      setPromptExecuted(false);
      setPresetTouched(true);
      return loadedMessages;
    } catch {
      toast.error("Couldn't load that chat");
      return null;
    }
  }

  // Load the active folder's shared context whenever the folder changes.
  useEffect(() => {
    if (!folderId) {
      setFolderContext("");
      setFolderName(null);
      return;
    }
    folderContextFn({ data: { id: folderId } })
      .then(({ context, name }: { context: string; name: string | null }) => {
        setFolderContext(context);
        setFolderName(name);
      })
      .catch((err) => console.error("[folders] context load failed:", err));
  }, [folderId, folderContextFn]);

  useEffect(() => {
    const wantsCorrections = new URLSearchParams(window.location.search).get("corrections") === "1";
    if (wantsCorrections) window.history.replaceState(null, "", window.location.pathname);

    // Deep links: ?chat=… opens a specific chat; ?folder=… starts fresh in a folder.
    if (search.chat) {
      handleSelectConversation(search.chat);
      return;
    }
    if (search.folder) return;

    listConversationsFn({ data: { tool: "analyze" } })
      .then(async ({ conversations }: { conversations: { id: string }[] }) => {
        let resolvedMessages = messages;
        if (conversations.length > 0) {
          const loaded = await handleSelectConversation(conversations[0].id);
          if (loaded) resolvedMessages = loaded;
        }
        if (wantsCorrections) {
          if (resolvedMessages.length > 0) {
            setFeedbackModalOpen(true);
          } else {
            toast.info("Start a draft first, then apply corrections from the menu.");
          }
        }
      })
      .catch((err) => {
        console.error("[chat-history] list failed:", err);
        if (wantsCorrections) {
          if (messages.length > 0) setFeedbackModalOpen(true);
          else toast.info("Start a draft first, then apply corrections from the menu.");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(p: InstructionsPreset) {
    setInstructionsPreset(p);
    setPresetTouched(true);
  }

  // Manual trigger for the plan-first conversation under the user's CURRENT template — the
  // AI adapts that template's standards into a tailored prompt for this work.
  // v1 "Create Prompt" (Pro+) asks clarifying questions; v2 "Meta Prompt" (Max only) instead
  // mines the uploaded brief/files itself and only asks when something essential is missing.
  function startPromptBuild(mode: "build" | "meta") {
    setPresetTouched(true);
    setPromptMode(true);
    setPromptExecuted(false);
    send(
      mode === "meta"
        ? "Build a meta prompt for this work — pull everything you can straight from the brief and uploaded material, and only ask me about what's genuinely missing. Then show me the finished prompt and wait for my go-ahead."
        : "Before writing anything, build a tailored prompt for this work. Ask me any clarifying questions you need first, then show me the finished prompt and wait for my go-ahead.",
      mode,
    );
  }

  function executePrompt() {
    setPromptExecuted(true);
    send("The prompt looks right — execute it now and write the full work, in full.", "execute");
  }

  async function summarizeDocFiles(files: File[]) {
    setDocFiles(files);
    if (!files.length) {
      setDocSummary("");
      return;
    }
    setSummarizingDocs(true);
    setFailedDocs([]);
    try {
      const payload: { name: string; text: string }[] = [];
      const failed: string[] = [];
      for (const f of files) {
        try {
          const data = await readAsBase64(f);
          const { text } = await extractDocTextFn({ data: { name: f.name, data } });
          payload.push({ name: f.name, text });
        } catch (e) {
          console.error(`[analyze] could not read "${f.name}":`, e);
          failed.push(f.name);
        }
      }
      setFailedDocs(failed);
      if (!payload.length)
        throw new Error(
          "Could not read any of those documents — try them one at a time to find the bad one.",
        );

      const res = await summarizeDocsFn({ data: { files: payload } });
      setDocSummary(res.summary);
      if (failed.length) {
        toast.warning(
          `Read ${payload.length} of ${files.length} documents — couldn't read: ${failed.join(", ")}`,
        );
      } else {
        toast.success(`Read ${files.length} document${files.length > 1 ? "s" : ""} for context`);
      }
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
    setProjectId("");
    setFileName("");
    setFileRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      toast.error("Couldn't read any rows from that file — expecting a CSV with a header row.");
      return;
    }
    setFileName(file.name);
    setFileRows(rows);
    toast.success(`Loaded ${rows.length} rows from ${file.name}`);
  }

  /** Routes dropped/attached files: a single bare .csv becomes the data source (so it's
   *  usable for real statistics), everything else is added as a background document. */
  function handleIncomingFiles(files: File[]) {
    if (!files.length) return;
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".csv") && !fileRows.length) {
      setSourceTab("file");
      handleFile(files[0]);
      return;
    }
    addDocFiles(files);
  }

  function currentSource() {
    if (sourceTab === "project" && projectId)
      return { type: "project" as const, project_id: projectId };
    if (sourceTab === "file" && fileRows.length)
      return { type: "file" as const, filename: fileName, rows: fileRows };
    return { type: "none" as const };
  }

  async function send(overrideText?: string, promptModeArg?: "build" | "execute" | "meta") {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    // While the prompt is still being built (no prompt table yet), keep typed turns in
    // build mode so the AI keeps clarifying instead of reverting to "just write it".
    const tableReadyNow = /\|\s*:?-{2,}:?\s*\|/.test(
      [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "",
    );
    const effectiveMode =
      promptModeArg ?? (promptMode && !promptExecuted && !tableReadyNow ? "build" : undefined);
    const nextMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    if (!overrideText) setInput("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let raw = "";
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
          folderContext: folderContext || undefined,
          promptMode: effectiveMode,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || "Analysis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { text: withoutError } = splitStreamError(raw);
        const { display, options } = splitMarkers(withoutError);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: display, options };
          return copy;
        });
      }

      const { text: rawText, error: streamError } = splitStreamError(raw);
      if (streamError) throw new Error(streamError);
      const { display, chart, table, sources, chartImage, figureRequests, options } =
        splitMarkers(rawText);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: display.trim() || "I couldn't generate an answer for that.",
          chart,
          table,
          options,
          sources,
          chartImage,
          generatingFigures: figureRequests.length > 0,
        };
        return copy;
      });

      if (figureRequests.length > 0) {
        const messageIndex = nextMessages.length;
        const figures = await Promise.all(
          figureRequests.map(async (req): Promise<FigureImage | null> => {
            try {
              const { base64, mediaType } = await generateFigureImageFn({
                data: { prompt: req.prompt },
              });
              return { caption: req.caption, base64, mediaType };
            } catch (err) {
              console.error("[analyze] figure generation failed:", err);
              toast.error(
                `Couldn't render a figure: ${err instanceof Error ? err.message : "image generation failed"}`,
              );
              return null;
            }
          }),
        );
        setMessages((prev) => {
          const copy = [...prev];
          const current = copy[messageIndex];
          if (current)
            copy[messageIndex] = {
              ...current,
              figures: figures.filter((f): f is FigureImage => f !== null),
              generatingFigures: false,
            };
          return copy;
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        const { display } = splitMarkers(splitStreamError(raw).text);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: display.trim() || "(stopped)" };
          return copy;
        });
      } else {
        toast.error(e instanceof Error ? e.message : "Analysis failed");
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: "Sorry, I couldn't process that — please try again.",
          };
          return copy;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  const sourceLabel =
    sourceTab === "project"
      ? (projectsQ.data ?? []).find((p: any) => p.id === projectId)?.name
      : fileName;

  const sourceActive = sourceTab === "project" ? !!projectId : !!fileName;

  // The prompt builder signals it's done by emitting a markdown table (the prompt spec).
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const promptTableReady = /\|\s*:?-{2,}:?\s*\|/.test(lastAssistant?.content ?? "");

  return (
    <AppShell fullScreenMobile>
      {(openMobileMenu) => (
        <>
          <div className="mx-auto max-w-[1400px] p-0 sm:p-6 flex flex-col h-dvh">
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0 px-3 pt-3 sm:px-0 sm:pt-0">
              <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 truncate min-w-0">
                <button
                  onClick={openMobileMenu}
                  className="md:hidden -ml-1.5 p-1.5 shrink-0 text-muted-foreground"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </button>
                <BarChart3 className="size-5 shrink-0 hidden sm:block" /> Writing
              </h1>
              {messages.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={exportDocument} disabled={exporting}>
                      {exporting ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : (
                        <FileDown className="size-4 mr-2" />
                      )}
                      Download document
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFeedbackModalOpen(true)}>
                      <ClipboardCheck className="size-4 mr-2" />
                      Apply feedback corrections
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setMessages([])}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-4 mr-2" /> Clear conversation
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <Card
              className="p-0 flex flex-col flex-1 min-h-0 overflow-hidden rounded-none border-0 shadow-none sm:rounded-lg sm:border-x-2 sm:shadow relative"
              onDragEnter={(e) => {
                e.preventDefault();
                dragCounter.current += 1;
                setIsDraggingFile(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                e.preventDefault();
                dragCounter.current -= 1;
                if (dragCounter.current <= 0) {
                  dragCounter.current = 0;
                  setIsDraggingFile(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                dragCounter.current = 0;
                setIsDraggingFile(false);
                handleIncomingFiles(Array.from(e.dataTransfer.files ?? []));
              }}
            >
              {isDraggingFile && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm pointer-events-none rounded-none sm:rounded-lg border-2 border-dashed border-primary">
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <Upload className="size-8" />
                    <p className="text-sm font-medium">Drop files to add them to this chat</p>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-6">
                    <BarChart3 className="size-10 mb-3 opacity-60" />
                    <p className="text-sm max-w-sm">
                      {sourceActive
                        ? `Ask anything about "${sourceLabel}" — e.g. "what's the breakdown of answers to question 2?"`
                        : "Pick a data source from the toolbar below, then ask a question."}
                    </p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                          : "w-full sm:max-w-[85%] rounded-none bg-transparent px-0 py-0 text-sm sm:rounded-lg sm:bg-muted sm:px-3 sm:py-2"
                      }
                    >
                      {m.role === "assistant" ? (
                        <MarkdownLite text={m.content} />
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {m.chart && m.chart.data?.length > 0 && (
                        <div className="mt-3 bg-background rounded p-2">
                          <p className="text-xs font-medium mb-1">{m.chart.title}</p>
                          <ResponsiveContainer width="100%" height={220}>
                            {m.chart.type === "pie" ? (
                              <PieChart>
                                <Pie
                                  data={m.chart.data}
                                  dataKey="value"
                                  nameKey="name"
                                  cx="50%"
                                  cy="50%"
                                  outerRadius={80}
                                  label
                                >
                                  {m.chart.data.map((_, idx) => (
                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                              </PieChart>
                            ) : m.chart.type === "line" ? (
                              <LineChart data={m.chart.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Line
                                  type="monotone"
                                  dataKey="value"
                                  stroke="#84cc16"
                                  strokeWidth={2}
                                />
                              </LineChart>
                            ) : (
                              <BarChart data={m.chart.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="value" fill="#84cc16" />
                              </BarChart>
                            )}
                          </ResponsiveContainer>
                        </div>
                      )}
                      {m.chartImage && (
                        <div className="mt-3 bg-background rounded p-2">
                          <img
                            src={`data:image/png;base64,${m.chartImage}`}
                            alt="Generated chart"
                            className="max-w-full rounded"
                          />
                        </div>
                      )}
                      {m.generatingFigures && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> Drawing figure…
                        </div>
                      )}
                      {m.figures && m.figures.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {m.figures.map((fig, fi) => (
                            <figure key={fi} className="bg-background rounded p-2 border">
                              <img
                                src={`data:${fig.mediaType};base64,${fig.base64}`}
                                alt={fig.caption || "Generated figure"}
                                className="max-w-full rounded"
                              />
                              {fig.caption && (
                                <figcaption className="mt-1.5 text-xs text-muted-foreground text-center">
                                  {fig.caption}
                                </figcaption>
                              )}
                            </figure>
                          ))}
                        </div>
                      )}
                      {m.table && m.table.rows?.length > 0 && (
                        <div className="mt-3 overflow-x-auto bg-background rounded p-2">
                          <table className="text-xs w-full">
                            <thead>
                              <tr>
                                {m.table.columns.map((c, idx) => (
                                  <th
                                    key={idx}
                                    className="text-left font-semibold px-2 py-1 border-b"
                                  >
                                    {c}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {m.table.rows.map((row, ri) => (
                                <tr key={ri}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} className="px-2 py-1 border-b">
                                      {String(cell)}
                                    </td>
                                  ))}
                                </tr>
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
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline break-all"
                                >
                                  {s.authors?.length ? `${s.authors.join(", ")} ` : ""}
                                  {s.year ? `(${s.year}) ` : ""}
                                  {s.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {m.role === "assistant" &&
                        m.options &&
                        m.options.length > 0 &&
                        i === messages.length - 1 &&
                        !sending && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {m.options.map((opt, oi) => (
                              <Button
                                key={oi}
                                size="sm"
                                variant="outline"
                                className="h-auto whitespace-normal py-1.5 text-left text-xs"
                                onClick={() => send(opt, "build")}
                              >
                                {opt}
                              </Button>
                            ))}
                          </div>
                        )}
                      {m.role === "assistant" &&
                        m.content.trim() !== "" &&
                        !(sending && i === messages.length - 1) && (
                          <div className="mt-2 flex items-center gap-3">
                            <button
                              onClick={() => copyMessage(i, m.content)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {copiedIndex === i ? (
                                <>
                                  <CopyCheck className="size-3.5" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3.5" /> Copy
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => downloadMessage(i, m.content)}
                              disabled={downloadingIndex === i}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                              {downloadingIndex === i ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <FileDown className="size-3.5" />
                              )}{" "}
                              Download
                            </button>
                          </div>
                        )}
                    </div>
                  </div>
                ))}
                {sending && messages[messages.length - 1]?.content === "" && (
                  <div className="flex justify-start">
                    <div className="bg-transparent px-0 py-0 text-sm flex items-center gap-2 text-muted-foreground sm:bg-muted sm:rounded-lg sm:px-3 sm:py-2">
                      <Loader2 className="size-3.5 animate-spin" /> Thinking...
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* "Execute the prompt?" — shown once the builder has drafted a prompt table */}
              {promptMode && !promptExecuted && !sending && promptTableReady && (
                <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs sm:mx-0">
                  <Sparkles className="size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    Prompt ready. Execute it now and write the full work?
                  </span>
                  <Button size="sm" className="h-6 px-2 text-xs" onClick={executePrompt}>
                    Execute
                  </Button>
                  <button
                    onClick={() => setPromptExecuted(true)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Not yet"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Composer — textarea on top, tool icons + send in a single bar */}
              <div className="m-2 rounded-3xl border bg-card shadow-sm p-2.5 sm:m-0 sm:rounded-none sm:border-0 sm:border-t-2 sm:bg-background sm:shadow-none sm:p-3 shrink-0">
                <Textarea
                  ref={textareaRef}
                  rows={1}
                  placeholder="Ask about your data..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  className="resize-none min-h-0 max-h-40 border-0 focus-visible:ring-0 shadow-none px-1 py-1 text-base overflow-y-auto"
                />
                <div className="flex items-center gap-1 mt-1">
                  <ChatHistoryMenu
                    tool="analyze"
                    activeId={conversationId}
                    folderId={folderId}
                    onSelect={handleSelectConversation}
                    onNew={handleNewChat}
                  />
                  {folderId && folderName && <FolderBadge id={folderId} name={folderName} />}
                  <input
                    ref={docFileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.markdown"
                    className="hidden"
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      if (fs.length) handleIncomingFiles(fs);
                      if (docFileInputRef.current) docFileInputRef.current.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    title="Attach files"
                    onClick={() => docFileInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={sourceActive ? "default" : "ghost"}
                        size="sm"
                        className="h-8 gap-1.5 px-2 max-w-[160px]"
                        title={sourceActive ? sourceLabel : "Data source"}
                      >
                        <Database className="size-4 shrink-0" />
                        <span className="truncate text-xs hidden sm:inline">
                          {sourceActive ? sourceLabel : "Data"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="start" side="top">
                      <h3 className="font-semibold text-sm mb-3">Data source</h3>
                      <Tabs
                        value={sourceTab}
                        onValueChange={(v) => {
                          setSourceTab(v as any);
                          clearSource();
                        }}
                      >
                        <TabsList className="grid grid-cols-2 w-full">
                          <TabsTrigger value="project">Project</TabsTrigger>
                          <TabsTrigger value="file">Upload file</TabsTrigger>
                        </TabsList>
                        <TabsContent value="project" className="space-y-2 mt-3">
                          <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a project" />
                            </SelectTrigger>
                            <SelectContent>
                              {(projectsQ.data ?? []).map((p: any) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Analyzes that project's surveys, responses, and personas.
                          </p>
                        </TabsContent>
                        <TabsContent value="file" className="space-y-2 mt-3">
                          <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                            <Upload className="size-5 text-muted-foreground" />
                            <span className="text-sm font-medium">Choose a CSV file</span>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".csv,.txt"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFile(f);
                              }}
                            />
                          </label>
                          {fileName && (
                            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                              <span className="flex items-center gap-2 truncate">
                                <FileText className="size-4 text-muted-foreground shrink-0" />{" "}
                                {fileName} ({fileRows.length} rows)
                              </span>
                              <button
                                onClick={clearSource}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            CSV with a header row. Columns are auto-summarized for the AI.
                          </p>
                        </TabsContent>
                      </Tabs>
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={
                          docFiles.length > 0 || docSummary.trim() !== "" ? "default" : "ghost"
                        }
                        size="sm"
                        className="h-8 gap-1.5 px-2"
                        title="Background docs"
                      >
                        <FileStack className="size-4 shrink-0" />
                        <span className="text-xs hidden sm:inline">
                          {docFiles.length > 0 ? `${docFiles.length}` : "Docs"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="start" side="top">
                      <h3 className="font-semibold text-sm mb-1">Background documents</h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        Upload chapters, reports, or methodology so the AI has full context.
                        Summarized once and never used as data to compute statistics from.
                      </p>
                      <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                        <Upload className="size-5 text-muted-foreground" />
                        <span className="text-sm font-medium">Choose documents</span>
                        <span className="text-xs text-muted-foreground">
                          PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), .txt, or .md
                        </span>
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.markdown"
                          className="hidden"
                          onChange={(e) => {
                            const fs = Array.from(e.target.files ?? []);
                            if (fs.length) addDocFiles(fs);
                          }}
                        />
                      </label>
                      {docFiles.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {docFiles.map((f, i) => {
                            const status: IngestStatus = summarizingDocs
                              ? "reading"
                              : failedDocs.includes(f.name)
                                ? "failed"
                                : "ready";
                            return (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                              >
                                <span className="flex min-w-0 items-center gap-2 truncate">
                                  <FileText
                                    className={cn("size-4 shrink-0", ingestIconClass(status))}
                                  />{" "}
                                  {f.name}
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <IngestBadge status={status} />
                                  {status === "failed" && (
                                    <button
                                      onClick={() => summarizeDocFiles(docFiles)}
                                      className="text-muted-foreground hover:text-foreground"
                                      title="Try again"
                                    >
                                      <RefreshCw className="size-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => removeDocFile(i)}
                                    className="text-muted-foreground hover:text-destructive"
                                    title="Remove"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {docFiles.length === 0 && docSummary.trim() !== "" && (
                        <div className="mt-3 flex items-center justify-between rounded border px-3 py-2 text-sm">
                          <span className="flex items-center gap-2 truncate text-muted-foreground">
                            <FileText className="size-4 shrink-0" /> Background context restored
                            from a previous session
                          </span>
                          <button
                            onClick={() => setDocSummary("")}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>

                  <TooltipProvider delayDuration={200}>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden sm:inline-flex size-8 relative shrink-0"
                          onClick={() => startPromptBuild("build")}
                          disabled={sending}
                        >
                          <Logo className="size-4" />
                          <span className="absolute -bottom-0.5 -right-0.5 text-[9px] leading-none">
                            🔨
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Create prompt</TooltipContent>
                    </UiTooltip>
                  </TooltipProvider>

                  {modelTier === "max" && (
                    <TooltipProvider delayDuration={200}>
                      <UiTooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hidden sm:inline-flex size-8 relative shrink-0"
                            onClick={() => startPromptBuild("meta")}
                            disabled={sending}
                          >
                            <Logo className="size-4" />
                            <Sparkles className="absolute -bottom-1 -right-1 size-3 text-primary" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Meta prompt</TooltipContent>
                      </UiTooltip>
                    </TooltipProvider>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="sm:hidden size-8 shrink-0"
                        disabled={sending}
                        title="Build a prompt"
                      >
                        <span className="text-base leading-none">🔨</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      <DropdownMenuItem onClick={() => startPromptBuild("build")}>
                        Create Prompt
                      </DropdownMenuItem>
                      {modelTier === "max" && (
                        <DropdownMenuItem onClick={() => startPromptBuild("meta")}>
                          Meta Prompt
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 gap-1.5 px-2 max-w-[180px]"
                        title="Instructions"
                      >
                        <ListChecks className="size-4 shrink-0" />
                        <span className="truncate text-xs hidden sm:inline">
                          {PRESET_LABELS[instructionsPreset]}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="start" side="top">
                      <Label className="text-sm font-semibold">Writing template</Label>
                      <div className="grid gap-1.5 mt-2">
                        {(
                          [
                            "chapter4-quant",
                            "chapter4-qual",
                            "chapter4-mixed",
                            "other-writing",
                            "basic-academia",
                            "dissertations",
                          ] as InstructionsPreset[]
                        ).map((p) => (
                          <button
                            key={p}
                            onClick={() => applyPreset(p)}
                            className={cn(
                              "flex items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm font-medium transition-colors",
                              instructionsPreset === p
                                ? "border-primary bg-primary/5"
                                : "hover:bg-muted/40",
                            )}
                          >
                            {PRESET_FULL_LABELS[p]}
                            {instructionsPreset === p && <Check className="size-3.5 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div className="ml-auto">
                    {sending ? (
                      <Button
                        onClick={stopGenerating}
                        variant="secondary"
                        size="icon"
                        className="size-9"
                        title="Stop"
                      >
                        <Square className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => send()}
                        disabled={!input.trim()}
                        size="icon"
                        className="size-9"
                      >
                        <Send className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>
          <SupervisorFeedbackModal
            open={feedbackModalOpen}
            onClose={() => setFeedbackModalOpen(false)}
            documentText={documentText()}
            documentTitle={documentTitle()}
            onApplied={handleCorrectionsApplied}
          />
        </>
      )}
    </AppShell>
  );
}
