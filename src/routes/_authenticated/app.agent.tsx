import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Loader2,
  FileDown,
  FileStack,
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  Square,
  Copy,
  CopyCheck,
  Menu,
  Paperclip,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseMarkdownLite, blocksToHtml, blocksToPlainText } from "@/lib/markdown-lite";
import { exportToDocx, downloadBlob } from "@/lib/writing-export";
import { createAgentSessionFn, downloadAgentFileFn } from "@/lib/agent-chat.functions";
import { extractDocumentText } from "@/lib/document-extract.functions";
import {
  saveChatConversation,
  getChatConversation,
  listChatConversations,
} from "@/lib/chat-history.functions";
import { getFolderContext } from "@/lib/folders.functions";
import { ChatHistoryMenu } from "@/components/chat-history-menu";
import { FolderBadge } from "@/components/folder-badge";
import { IngestBadge, ingestIconClass, type IngestStatus } from "@/components/ingest-status";
import { useAutosizeTextarea } from "@/lib/use-autosize-textarea";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const Route = createFileRoute("/_authenticated/app/agent")({
  head: () => ({ meta: [{ title: "Agent · Paperstudio" }] }),
  validateSearch: (s: Record<string, unknown>): { folder?: string; chat?: string } => ({
    folder: typeof s.folder === "string" ? s.folder : undefined,
    chat: typeof s.chat === "string" ? s.chat : undefined,
  }),
  component: AgentPage,
});

type AgentFile = { fileId: string; filename?: string };
type Msg = { role: "user" | "assistant"; content: string; files?: AgentFile[] };

function splitFileMarkers(raw: string): { display: string; files: AgentFile[] } {
  const files: AgentFile[] = [];
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const match = /^@@FILE@@(.*)$/.exec(line);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed?.fileId) files.push({ fileId: parsed.fileId, filename: parsed.filename });
      } catch {
        // still streaming
      }
      continue;
    }
    kept.push(line);
  }
  return { display: kept.join("\n"), files };
}

function isTabularDoc(filename: string, text: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  // Detect by extension regardless of extractor — sandboxed xlsx/xls comes back as a
  // markdown table, not the "Sheet: " text-extractor format, so content-sniffing alone
  // would miss it.
  if (ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "xls") return true;
  return /^Sheet: /m.test(text);
}

function truncateRowsAware(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  let out = header;
  let i = 1;
  for (; i < lines.length; i++) {
    const next = out.length + 1 + lines[i].length;
    if (next > budget) break;
    out += "\n" + lines[i];
  }
  const omitted = lines.length - i;
  return omitted > 0 ? `${out}\n…[${omitted} more rows omitted for length]` : out;
}

/** Gives every uploaded file a guaranteed share of the total budget instead of
 *  concatenating-then-flat-slicing, which silently drops whichever files land later in
 *  the list once the cap is hit. Tabular files get a bigger share and are truncated on
 *  row boundaries so a cut never misaligns columns. */
function budgetDocTexts(docTexts: { name: string; text: string }[], totalBudget: number): string {
  const tabularCount = docTexts.filter((d) => isTabularDoc(d.name, d.text)).length;
  const narrativeCount = docTexts.length - tabularCount;
  const tabularBudget = tabularCount > 0 ? Math.floor((totalBudget * 0.6) / tabularCount) : 0;
  const narrativeBudget =
    narrativeCount > 0 ? Math.floor((totalBudget * (tabularCount > 0 ? 0.4 : 1)) / narrativeCount) : 0;

  return docTexts
    .map((d) => {
      const tabular = isTabularDoc(d.name, d.text);
      const budget = tabular ? tabularBudget : narrativeBudget;
      const text = d.text.length <= budget ? d.text : tabular ? truncateRowsAware(d.text, budget) : d.text.slice(0, budget) + "\n…[truncated]";
      return `===== FILE: ${d.name} =====\n${text}`;
    })
    .join("\n\n");
}

function AgentPage() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createSession = useServerFn(createAgentSessionFn);
  const saveConversationFn = useServerFn(saveChatConversation);
  const getConversationFn = useServerFn(getChatConversation);
  const listConversationsFn = useServerFn(listChatConversations);
  const downloadFileFn = useServerFn(downloadAgentFileFn);
  const extractDocTextFn = useServerFn(extractDocumentText);
  const folderContextFn = useServerFn(getFolderContext);
  const search = Route.useSearch();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(search.folder ?? null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderContext, setFolderContext] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docTexts, setDocTexts] = useState<{ name: string; text: string }[]>([]);
  const [failedDocs, setFailedDocs] = useState<string[]>([]);
  const [readingDocs, setReadingDocs] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  useAutosizeTextarea(textareaRef, input);

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
      toast.error("Couldn't copy to clipboard");
    }
  }

  async function downloadMessage(index: number, content: string) {
    setDownloadingIndex(index);
    try {
      const blob = await exportToDocx(content);
      downloadBlob(blob, "agent-response.docx");
    } catch {
      toast.error("Couldn't download that message");
    } finally {
      setDownloadingIndex(null);
    }
  }

  // Read one file into context; keeps it as "failed" (retryable) rather than aborting the batch.
  async function readOneDoc(f: File): Promise<boolean> {
    setFailedDocs((prev) => prev.filter((n) => n !== f.name));
    try {
      const data = await readAsBase64(f);
      const { text } = await extractDocTextFn({ data: { name: f.name, data } });
      setDocTexts((prev) => [...prev.filter((t) => t.name !== f.name), { name: f.name, text }]);
      return true;
    } catch (e) {
      console.error(`[agent] could not read "${f.name}":`, e);
      setFailedDocs((prev) => [...new Set([...prev, f.name])]);
      return false;
    }
  }

  async function addDocFiles(newFiles: File[]) {
    setDocFiles((prev) => [...prev, ...newFiles]);
    setReadingDocs(true);
    let ok = 0;
    const failed: string[] = [];
    for (const f of newFiles) {
      if (await readOneDoc(f)) ok++;
      else failed.push(f.name);
    }
    setReadingDocs(false);
    if (failed.length && ok)
      toast.warning(`Read ${ok} of ${newFiles.length} — couldn't read: ${failed.join(", ")}`);
    else if (failed.length) toast.error(`Couldn't read: ${failed.join(", ")}`);
    else
      toast.success(
        `Read ${newFiles.length} document${newFiles.length > 1 ? "s" : ""} for context`,
      );
  }

  async function retryDocFile(f: File) {
    setReadingDocs(true);
    await readOneDoc(f);
    setReadingDocs(false);
  }

  function removeDocFile(index: number) {
    const f = docFiles[index];
    setDocFiles((prev) => prev.filter((_, i) => i !== index));
    if (f) {
      setDocTexts((prev) => prev.filter((t) => t.name !== f.name));
      setFailedDocs((prev) => prev.filter((n) => n !== f.name));
    }
  }

  /** Routes dropped/attached files into the background-docs flow. */
  function handleIncomingFiles(files: File[]) {
    if (!files.length) return;
    addDocFiles(files);
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  async function handleDownloadFile(fileId: string) {
    setDownloadingFile(fileId);
    try {
      const { base64, mediaType, filename } = await downloadFileFn({ data: { fileId } });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mediaType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download that file");
    } finally {
      setDownloadingFile(null);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const pendingIdRef = useRef<Promise<string> | null>(null);
  const expectedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      expectedConversationIdRef.current = null;
      pendingIdRef.current = null;
      return;
    }
    if (expectedConversationIdRef.current !== conversationId) return;
    const handle = setTimeout(() => {
      const state = { messages };
      const runSave = async () => {
        try {
          if (conversationId) {
            await saveConversationFn({
              data: {
                id: conversationId,
                tool: "agent",
                state,
                agentSessionId: sessionId ?? undefined,
              },
            });
            return;
          }
          if (pendingIdRef.current) {
            const id = await pendingIdRef.current;
            await saveConversationFn({
              data: { id, tool: "agent", state, agentSessionId: sessionId ?? undefined },
            });
            return;
          }
          const firstUserMsg = messages.find((m) => m.role === "user")?.content ?? "New chat";
          const title = firstUserMsg.slice(0, 80);
          const p = saveConversationFn({
            data: {
              tool: "agent",
              title,
              state,
              agentSessionId: sessionId ?? undefined,
              folderId,
            },
          }).then(({ id }: { id: string }) => id);
          pendingIdRef.current = p;
          const id = await p;
          expectedConversationIdRef.current = id;
          setConversationId(id);
        } catch (err) {
          pendingIdRef.current = null;
          console.error("[chat-history] save failed:", err);
          toast.error(
            `Couldn't save chat history: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      };
      runSave();
    }, 1000);
    return () => clearTimeout(handle);
  }, [messages, sessionId, conversationId, folderId, saveConversationFn]);

  function handleNewChat() {
    pendingIdRef.current = null;
    expectedConversationIdRef.current = undefined as unknown as null;
    preWarmRef.current = null;
    setConversationId(null);
    setSessionId(null);
    setMessages([]);
    setInput("");
    // Keep the active folder so consecutive new chats stay in it.
  }

  async function handleSelectConversation(id: string) {
    pendingIdRef.current = null;
    expectedConversationIdRef.current = undefined as unknown as null;
    try {
      const { conversation } = await getConversationFn({ data: { id } });
      const state = (conversation.state ?? {}) as { messages?: Msg[] };
      expectedConversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      setSessionId(conversation.agent_session_id ?? null);
      setMessages(state.messages ?? []);
      setFolderId(conversation.folder_id ?? null);
    } catch {
      toast.error("Couldn't load that chat");
    }
  }

  useEffect(() => {
    // A deep link wins: ?chat=… opens a specific chat, ?folder=… starts fresh in a folder.
    if (search.chat) {
      handleSelectConversation(search.chat);
      return;
    }
    if (search.folder) return; // new chat in folder — don't auto-open the latest
    listConversationsFn({ data: { tool: "agent" } })
      .then(({ conversations }: { conversations: { id: string }[] }) => {
        if (conversations.length > 0) handleSelectConversation(conversations[0].id);
      })
      .catch((err) => console.error("[chat-history] list failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the active folder's shared context (instructions + files) whenever the folder changes.
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

  // Pre-warm: kick off session creation in the background as soon as the page loads with a
  // fresh chat (no existing sessionId), so the user doesn't wait for it on their first send.
  const preWarmRef = useRef<Promise<string> | null>(null);
  useEffect(() => {
    if (sessionId) return; // already have one (loaded from history)
    if (preWarmRef.current) return; // already warming
    preWarmRef.current = createSession()
      .then(({ sessionId: id }) => {
        setSessionId(id);
        return id;
      })
      .catch((err) => {
        preWarmRef.current = null; // allow retry on next send
        console.error("[agent] pre-warm session failed:", err);
        return Promise.reject(err);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    if (preWarmRef.current) {
      // The background warm-up is in flight — await it instead of starting a second one.
      try {
        return await preWarmRef.current;
      } catch {
        // Pre-warm failed; fall through to a fresh attempt below.
        preWarmRef.current = null;
      }
    }
    setStarting(true);
    try {
      const { sessionId: id } = await createSession();
      setSessionId(id);
      return id;
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const id = await ensureSession();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const folderBlock = folderContext ? `${folderContext}\n\n` : "";
      const docContext = docTexts.length
        ? `${folderBlock}Uploaded document context:\n${budgetDocTexts(docTexts, 60000)}\n\nUSER REQUEST:\n${text}`
        : folderBlock
          ? `${folderBlock}USER REQUEST:\n${text}`
          : text;

      const res = await fetch("/api/agent-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: id, message: docContext }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || "The agent didn't respond");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { display, files } = splitFileMarkers(raw);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: display, files };
          return copy;
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, content: last.content || "(stopped)" };
          return copy;
        });
      } else {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: "Sorry, I hit an error — please try again.",
          };
          return copy;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <AppShell fullScreenMobile>
      {(openMobileMenu) => (
        <div className="flex h-dvh flex-col gap-4 p-0 sm:p-6">
          <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:px-0 sm:pt-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={openMobileMenu}
                className="md:hidden -ml-1.5 p-1.5 shrink-0 text-muted-foreground"
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </button>
              <Bot className="h-5 w-5 text-primary shrink-0 hidden sm:block" />
              <div>
                <h1 className="text-lg font-semibold">Agent</h1>
                <p className="text-sm text-muted-foreground hidden sm:block">
                  An open-ended assistant that can analyze data, write, and build presentations end
                  to end — generating real .pptx/.xlsx/.docx files when you ask. It doesn't handle
                  Surveys or Interviews — use those tools directly for that.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {folderId && folderName && <FolderBadge id={folderId} name={folderName} />}
              <ChatHistoryMenu
                tool="agent"
                activeId={conversationId}
                folderId={folderId}
                onSelect={handleSelectConversation}
                onNew={handleNewChat}
              />
            </div>
          </div>

          <Card
            className="flex-1 overflow-y-auto p-4 min-h-0 rounded-none border-0 shadow-none sm:rounded-lg sm:border-x-2 sm:shadow relative"
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
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {starting
                  ? "Starting a session…"
                  : "Ask it to analyze something, write a draft, or build a deck — say what you want, including any files it should produce."}
              </p>
            )}
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    m.role === "user"
                      ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-primary-foreground"
                      : "rounded-none bg-transparent p-0 sm:rounded-lg sm:bg-background sm:p-3",
                  )}
                >
                  {m.content ? (
                    <div
                      className="prose prose-sm max-w-none min-w-0 break-words [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap"
                      dangerouslySetInnerHTML={{
                        __html: blocksToHtml(parseMarkdownLite(m.content)),
                      }}
                    />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {m.files && m.files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {m.files.map((f) => (
                        <Button
                          key={f.fileId}
                          size="sm"
                          variant="secondary"
                          disabled={downloadingFile === f.fileId}
                          onClick={() => handleDownloadFile(f.fileId)}
                        >
                          {downloadingFile === f.fileId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          ) : (
                            <FileDown className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          {f.filename || "Download file"}
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
              ))}
            </div>
            <div ref={bottomRef} />
          </Card>

          <div className="m-2 mt-0 rounded-3xl border bg-card shadow-sm p-2.5 sm:m-0 sm:rounded-md sm:border sm:shadow-none sm:p-0 sm:bg-transparent shrink-0">
            {docFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1 pb-2">
                {docFiles.map((f, i) => {
                  const status: IngestStatus = failedDocs.includes(f.name)
                    ? "failed"
                    : docTexts.some((t) => t.name === f.name)
                      ? "ready"
                      : "reading";
                  return (
                    <span
                      key={i}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                        status === "failed" ? "border-destructive/40 bg-destructive/5" : "bg-muted/50",
                      )}
                      title={f.name}
                    >
                      <FileText className={cn("size-3 shrink-0", ingestIconClass(status))} />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                      {status === "reading" && (
                        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                      )}
                      {status === "failed" && (
                        <button
                          onClick={() => retryDocFile(f)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Try again"
                        >
                          <RefreshCw className="size-3" />
                        </button>
                      )}
                      <button
                        onClick={() => removeDocFile(i)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask the agent anything…"
              className="resize-none min-h-0 max-h-40 overflow-y-auto border-0 focus-visible:ring-0 shadow-none px-1 py-1 text-base sm:border sm:shadow-sm sm:px-3 sm:py-2"
              disabled={sending}
            />
            <div className="flex items-center gap-1 mt-1 sm:mt-2">
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
                    variant={docFiles.length > 0 ? "default" : "ghost"}
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
                    Upload files so the agent has context for what you're asking it to do.
                  </p>
                  <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                    {readingDocs ? (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      <Upload className="size-5 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {readingDocs ? "Reading documents…" : "Choose documents"}
                    </span>
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
                        const status: IngestStatus = failedDocs.includes(f.name)
                          ? "failed"
                          : docTexts.some((t) => t.name === f.name)
                            ? "ready"
                            : "reading";
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
                                  onClick={() => retryDocFile(f)}
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
                  <Button onClick={send} disabled={!input.trim()} size="icon" className="size-9">
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
