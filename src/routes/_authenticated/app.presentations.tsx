import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  Presentation, Send, Upload, FileText, Loader2, Trash2, FileStack, ListChecks, Check,
  FileDown, MoreHorizontal, Plus, ChevronUp, ChevronDown, Copy as CopyIcon, X,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { splitStreamError } from "@/lib/stream-error-marker";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { summarizePresentationDocuments } from "@/lib/presentations.functions";
import { generateFigureImage } from "@/lib/image-gen.server";
import { saveChatConversation, getChatConversation, listChatConversations } from "@/lib/chat-history.functions";
import { ChatHistoryMenu } from "@/components/chat-history-menu";
import { exportDeckToPptx, downloadBlob, deckTheme, sanitizeDeck, type Deck, type Slide } from "@/lib/presentation-export";

export const Route = createFileRoute("/_authenticated/app/presentations")({
  head: () => ({ meta: [{ title: "Presentations · Paperstudio" }] }),
  component: PresentationsPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const LAYOUT_LABELS: Record<Slide["layout"], string> = {
  title: "Title",
  section: "Section divider",
  bullets: "Bullets",
  "two-column": "Two column",
  stat: "Big stat",
  quote: "Quote",
  timeline: "Timeline",
  grid: "Grid / SWOT",
  table: "Table",
  closing: "Closing",
};

function blankSlide(layout: Slide["layout"]): Slide {
  switch (layout) {
    case "title": return { layout, title: "New title slide", subtitle: "Subtitle" };
    case "section": return { layout, title: "Section name" };
    case "bullets": return { layout, title: "Slide title", bullets: ["First point", "Second point"] };
    case "two-column": return { layout, title: "Slide title", columns: [{ heading: "Before", bullets: ["Point"] }, { heading: "After", bullets: ["Point"] }] };
    case "stat": return { layout, value: "73%", label: "What this number means" };
    case "quote": return { layout, quote: "A memorable quote.", author: "Name — Role" };
    case "timeline": return { layout, title: "Roadmap", stages: [{ label: "Q1", title: "Stage one" }, { label: "Q2", title: "Stage two" }] };
    case "grid": return { layout, title: "Slide title", items: [{ label: "Group A", bullets: ["Point"] }, { label: "Group B", bullets: ["Point"] }] };
    case "table": return { layout, title: "Slide title", tableColumns: ["Column A", "Column B"], tableRows: [["", ""]] };
    case "closing": return { layout, title: "Thank you", subtitle: "name@company.com" };
  }
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function splitDeckMarker(raw: string): { display: string; deck: Deck | null } {
  let deck: Deck | null = null;
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const match = /^@@DECK@@(.*)$/.exec(line);
    if (match) {
      try { deck = sanitizeDeck(JSON.parse(match[1])); } catch { /* still streaming */ }
      continue;
    }
    kept.push(line);
  }
  return { display: kept.join("\n"), deck };
}

const STORAGE_KEY = "presentations-chat-state-v1";

type PersistedState = {
  messages: Msg[];
  instructions: string;
  docSummary: string;
  deck: Deck | null;
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
    // localStorage unavailable or too large — fail silently
  }
}

function linesToBullets(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function SlidePreview({ slide, theme, captureRef }: { slide: Slide; theme: ReturnType<typeof deckTheme>; captureRef?: (el: HTMLDivElement | null) => void }) {
  const dark = slide.layout === "title" || slide.layout === "section" || slide.layout === "quote" || slide.layout === "closing";
  return (
    <div
      ref={captureRef}
      className="aspect-video w-full rounded-md flex flex-col p-4 overflow-hidden text-[10px] sm:text-xs relative"
      style={{ background: dark ? `#${theme.dark}` : `#${theme.light}`, color: dark ? `#${theme.light}` : "#33384A" }}
    >
      {slide.decoration && (
        <div className="absolute inset-0 pointer-events-none" dangerouslySetInnerHTML={{ __html: slide.decoration }} />
      )}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 min-h-0">
      {slide.layout === "title" && (
        <div className="flex-1 flex flex-col justify-center gap-1">
          <p className="font-bold text-base sm:text-lg leading-tight">{slide.title || "Untitled"}</p>
          {slide.subtitle && <p className="italic opacity-80">{slide.subtitle}</p>}
        </div>
      )}
      {slide.layout === "section" && (
        <div className="flex-1 flex flex-col justify-center gap-1">
          {slide.number && <p className="opacity-60 text-lg font-bold" style={{ color: `#${theme.secondary}` }}>{slide.number}</p>}
          <p className="font-bold text-base">{slide.title || "Section"}</p>
        </div>
      )}
      {(slide.layout === "grid" === false) && slide.layout === "bullets" && (
        <div className="flex-1 flex flex-col gap-1">
          <p className="font-semibold" style={{ color: `#${theme.primary}` }}>{slide.title || "Untitled"}</p>
          <div className="flex-1 flex gap-2 mt-1 min-h-0">
            <ul className="list-disc pl-3 space-y-0.5 flex-1">
              {(slide.bullets ?? []).slice(0, 6).map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            {slide.figurePrompt && (
              <div className="w-1/3 shrink-0 flex flex-col items-center justify-center gap-1">
                {slide.figureImage ? (
                  <img src={slide.figureImage} alt={slide.figureCaption || "Figure"} className="max-w-full max-h-full rounded object-contain" />
                ) : (
                  <Loader2 className="size-4 animate-spin opacity-60" />
                )}
                {slide.figureCaption && <p className="opacity-70 text-center">{slide.figureCaption}</p>}
              </div>
            )}
          </div>
        </div>
      )}
      {slide.layout === "two-column" && (
        <div className="flex-1 flex flex-col gap-1">
          <p className="font-semibold" style={{ color: `#${theme.primary}` }}>{slide.title || "Untitled"}</p>
          <div className="flex gap-2 flex-1 mt-1">
            {(slide.columns ?? []).slice(0, 2).map((c, i) => (
              <div key={i} className="flex-1 bg-black/5 rounded p-1.5">
                <p className="font-medium">{c.heading}</p>
                <ul className="list-disc pl-3 space-y-0.5">{c.bullets.slice(0, 4).map((b, j) => <li key={j}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {slide.layout === "stat" && (
        <div className="flex-1 flex flex-col justify-center gap-1">
          <p className="font-bold text-2xl sm:text-3xl" style={{ color: `#${theme.primary}` }}>{slide.value || "0%"}</p>
          <p>{slide.label}</p>
        </div>
      )}
      {slide.layout === "quote" && (
        <div className="flex-1 flex flex-col justify-center gap-1.5">
          <p className="italic">"{slide.quote}"</p>
          {slide.author && <p className="opacity-70" style={{ color: `#${theme.secondary}` }}>{slide.author}</p>}
        </div>
      )}
      {slide.layout === "timeline" && (
        <div className="flex-1 flex flex-col gap-1">
          <p className="font-semibold" style={{ color: `#${theme.primary}` }}>{slide.title || "Untitled"}</p>
          <div className="flex-1 flex items-center gap-1 mt-2">
            {(slide.stages ?? []).map((st, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="mx-auto size-2 rounded-full mb-1" style={{ background: st.done ? `#${theme.primary}` : "transparent", border: `1px solid #${theme.primary}` }} />
                <p className="opacity-70">{st.label}</p>
                <p className="font-medium">{st.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {slide.layout === "grid" && (
        <div className="flex-1 flex flex-col gap-1">
          <p className="font-semibold" style={{ color: `#${theme.primary}` }}>{slide.title || "Untitled"}</p>
          <div className="grid grid-cols-2 gap-1.5 flex-1 mt-1">
            {(slide.items ?? []).slice(0, 4).map((it, i) => (
              <div key={i} className="bg-black/5 rounded p-1.5">
                <p className="font-medium" style={{ color: it.color ? `#${it.color}` : `#${theme.primary}` }}>{it.label}</p>
                <ul className="list-disc pl-3 space-y-0.5">{it.bullets.slice(0, 3).map((b, j) => <li key={j}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {slide.layout === "table" && (
        <div className="flex-1 flex flex-col gap-1">
          <p className="font-semibold" style={{ color: `#${theme.primary}` }}>{slide.title || "Untitled"}</p>
          <table className="w-full mt-1">
            <thead><tr>{(slide.tableColumns ?? []).map((c, i) => <th key={i} className="text-left font-semibold px-1 border-b" style={{ borderColor: `#${theme.primary}` }}>{c}</th>)}</tr></thead>
            <tbody>{(slide.tableRows ?? []).slice(0, 4).map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci} className="px-1 border-b">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {slide.layout === "closing" && (
        <div className="flex-1 flex flex-col justify-center gap-1">
          <p className="font-bold text-base sm:text-lg">{slide.title || "Thank you"}</p>
          {slide.subtitle && <p className="opacity-80">{slide.subtitle}</p>}
        </div>
      )}
      </div>
    </div>
  );
}

function SlideEditor({ slide, onChange }: { slide: Slide; onChange: (patch: Partial<Slide>) => void }) {
  switch (slide.layout) {
    case "title":
    case "closing":
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <Input value={slide.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Subtitle" />
        </div>
      );
    case "section":
      return (
        <div className="space-y-2">
          <Input value={slide.number ?? ""} onChange={(e) => onChange({ number: e.target.value })} placeholder="Number (optional, e.g. 02)" />
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Section title" className="font-semibold" />
        </div>
      );
    case "bullets":
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <Textarea rows={5} value={(slide.bullets ?? []).join("\n")} onChange={(e) => onChange({ bullets: linesToBullets(e.target.value) })} placeholder="One bullet per line" />
          <Input value={slide.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} placeholder="Supporting note (optional)" />
        </div>
      );
    case "two-column": {
      const columns = slide.columns ?? [{ heading: "", bullets: [] }, { heading: "", bullets: [] }];
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1.5">
                <Input
                  value={columns[i]?.heading ?? ""}
                  placeholder={`Column ${i + 1} heading`}
                  onChange={(e) => {
                    const next = [...columns];
                    next[i] = { heading: e.target.value, bullets: columns[i]?.bullets ?? [] };
                    onChange({ columns: next });
                  }}
                />
                <Textarea
                  rows={4}
                  value={(columns[i]?.bullets ?? []).join("\n")}
                  placeholder="One point per line"
                  onChange={(e) => {
                    const next = [...columns];
                    next[i] = { heading: columns[i]?.heading ?? "", bullets: linesToBullets(e.target.value) };
                    onChange({ columns: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "stat":
      return (
        <div className="space-y-2">
          <Input value={slide.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} placeholder="Value, e.g. 73%" className="font-semibold" />
          <Input value={slide.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="What this number means" />
          <Input value={slide.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} placeholder="Supporting note (optional)" />
        </div>
      );
    case "quote":
      return (
        <div className="space-y-2">
          <Textarea rows={3} value={slide.quote ?? ""} onChange={(e) => onChange({ quote: e.target.value })} placeholder="Quote text" />
          <Input value={slide.author ?? ""} onChange={(e) => onChange({ author: e.target.value })} placeholder="Name — Role, Organization" />
        </div>
      );
    case "timeline": {
      const stages = slide.stages ?? [];
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <div className="space-y-1.5">
            {stages.map((st, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={st.label}
                  placeholder="Label (e.g. Q1)"
                  className="w-24"
                  onChange={(e) => {
                    const next = [...stages];
                    next[i] = { ...st, label: e.target.value };
                    onChange({ stages: next });
                  }}
                />
                <Input
                  value={st.title}
                  placeholder="Stage description"
                  onChange={(e) => {
                    const next = [...stages];
                    next[i] = { ...st, title: e.target.value };
                    onChange({ stages: next });
                  }}
                />
                <button onClick={() => onChange({ stages: stages.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-destructive shrink-0">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => onChange({ stages: [...stages, { label: "", title: "" }] })}>
            <Plus className="size-3.5" /> Add stage
          </Button>
        </div>
      );
    }
    case "grid": {
      const items = slide.items ?? [];
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <div className="grid grid-cols-2 gap-2">
            {items.map((it, i) => (
              <div key={i} className="space-y-1.5 border rounded p-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={it.label}
                    placeholder="Group label"
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...it, label: e.target.value };
                      onChange({ items: next });
                    }}
                  />
                  <button onClick={() => onChange({ items: items.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="size-3.5" />
                  </button>
                </div>
                <Textarea
                  rows={3}
                  value={it.bullets.join("\n")}
                  placeholder="One point per line"
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...it, bullets: linesToBullets(e.target.value) };
                    onChange({ items: next });
                  }}
                />
              </div>
            ))}
          </div>
          {items.length < 4 && (
            <Button variant="outline" size="sm" onClick={() => onChange({ items: [...items, { label: "", bullets: [] }] })}>
              <Plus className="size-3.5" /> Add group
            </Button>
          )}
        </div>
      );
    }
    case "table": {
      const cols = slide.tableColumns ?? [];
      const rows = slide.tableRows ?? [];
      return (
        <div className="space-y-2">
          <Input value={slide.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="font-semibold" />
          <Input
            value={cols.join(" | ")}
            placeholder="Column headers, separated by |"
            onChange={(e) => onChange({ tableColumns: e.target.value.split("|").map((c) => c.trim()) })}
          />
          <Textarea
            rows={4}
            value={rows.map((r) => r.join(" | ")).join("\n")}
            placeholder="One row per line, cells separated by |"
            onChange={(e) => onChange({ tableRows: e.target.value.split("\n").filter((l) => l.trim()).map((l) => l.split("|").map((c) => c.trim())) })}
          />
        </div>
      );
    }
  }
}

function PresentationsPage() {
  const summarizeDocsFn = useServerFn(summarizePresentationDocuments);
  const generateFigureImageFn = useServerFn(generateFigureImage);
  const saveConversationFn = useServerFn(saveChatConversation);
  const getConversationFn = useServerFn(getChatConversation);
  const listConversationsFn = useServerFn(listChatConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const initialRef = useRef<Partial<PersistedState> | null>(null);
  if (initialRef.current === null) initialRef.current = loadPersistedState();
  const initial = initialRef.current;

  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSummary, setDocSummary] = useState<string>(initial.docSummary ?? "");
  const [summarizingDocs, setSummarizingDocs] = useState(false);
  const [instructions, setInstructions] = useState(initial.instructions ?? "");

  const [messages, setMessages] = useState<Msg[]>(initial.messages ?? []);
  const [deck, setDeck] = useState<Deck | null>(initial.deck ?? null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const slidePreviewRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    savePersistedState({ messages, instructions, docSummary, deck });
  }, [messages, instructions, docSummary, deck]);

  useEffect(() => {
    if (messages.length === 0) return;
    const handle = setTimeout(() => {
      const firstUserMsg = messages.find((m) => m.role === "user")?.content ?? "New chat";
      const title = firstUserMsg.slice(0, 80);
      saveConversationFn({
        data: {
          id: conversationId ?? undefined,
          tool: "presentations",
          title,
          state: { messages, instructions, docSummary, deck },
        },
      }).then(({ id }: { id: string }) => {
        if (!conversationId) setConversationId(id);
      }).catch((err) => {
        console.error("[chat-history] save failed:", err);
        toast.error(`Couldn't save chat history: ${err instanceof Error ? err.message : "unknown error"}`);
      });
    }, 1000);
    return () => clearTimeout(handle);
  }, [messages, instructions, docSummary, deck, conversationId, saveConversationFn]);

  function handleNewChat() {
    setConversationId(null);
    setMessages([]);
    setDeck(null);
    setInput("");
    setDocFiles([]);
    setDocSummary("");
    setInstructions("");
  }

  async function handleSelectConversation(id: string) {
    try {
      const { conversation } = await getConversationFn({ data: { id } });
      const state = (conversation.state ?? {}) as Partial<PersistedState>;
      setConversationId(conversation.id);
      setMessages(state.messages ?? []);
      setInstructions(state.instructions ?? "");
      setDocSummary(state.docSummary ?? "");
      setDeck(state.deck ?? null);
      setDocFiles([]);
    } catch {
      toast.error("Couldn't load that chat");
    }
  }

  useEffect(() => {
    listConversationsFn({ data: { tool: "presentations" } })
      .then(({ conversations }: { conversations: { id: string }[] }) => {
        if (conversations.length > 0) handleSelectConversation(conversations[0].id);
      })
      .catch((err) => console.error("[chat-history] list failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function resolveFigures(targetDeck: Deck) {
    const pending = targetDeck.slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.figurePrompt && !s.figureImage);
    if (!pending.length) return;
    await Promise.all(
      pending.map(async ({ s, i }) => {
        try {
          const { base64, mediaType } = await generateFigureImageFn({ data: { prompt: s.figurePrompt! } });
          const dataUrl = `data:${mediaType};base64,${base64}`;
          setDeck((prev) => {
            if (!prev) return prev;
            const slides = [...prev.slides];
            if (slides[i]) slides[i] = { ...slides[i], figureImage: dataUrl };
            return { ...prev, slides };
          });
        } catch (err) {
          console.error("[presentations] figure generation failed:", err);
          toast.error(`Couldn't render a slide figure: ${err instanceof Error ? err.message : "image generation failed"}`);
          // leave figureImage unset on failure — slide just renders without it
        }
      }),
    );
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

      const res = await fetch("/api/presentations-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: nextMessages,
          background: docSummary || undefined,
          instructions: instructions.trim() || undefined,
          currentDeck: deck ?? undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || "Generation failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { text: withoutError } = splitStreamError(raw);
        const { display } = splitDeckMarker(withoutError);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: display };
          return copy;
        });
      }

      const { text: rawText, error: streamError } = splitStreamError(raw);
      if (streamError) throw new Error(streamError);
      const { display, deck: newDeck } = splitDeckMarker(rawText);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: display.trim() || "Here's the deck." };
        return copy;
      });
      if (newDeck && newDeck.slides?.length) {
        setDeck(newDeck);
        resolveFigures(newDeck);
      } else if (!newDeck) toast.error("Didn't get a deck back — try rephrasing your request.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Sorry, I couldn't build that — please try again." };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  function updateSlide(index: number, patch: Partial<Slide>) {
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = [...prev.slides];
      slides[index] = { ...slides[index], ...patch } as Slide;
      return { ...prev, slides };
    });
  }

  function addSlide(layout: Slide["layout"], atIndex?: number) {
    setDeck((prev) => {
      const base: Deck = prev ?? { title: "Untitled deck", slides: [] };
      const slides = [...base.slides];
      const insertAt = atIndex ?? slides.length;
      slides.splice(insertAt, 0, blankSlide(layout));
      return { ...base, slides };
    });
  }

  function removeSlide(index: number) {
    setDeck((prev) => {
      if (!prev) return prev;
      return { ...prev, slides: prev.slides.filter((_, i) => i !== index) };
    });
  }

  function duplicateSlide(index: number) {
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = [...prev.slides];
      slides.splice(index + 1, 0, JSON.parse(JSON.stringify(slides[index])));
      return { ...prev, slides };
    });
  }

  function moveSlide(index: number, dir: -1 | 1) {
    setDeck((prev) => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.slides.length) return prev;
      const slides = [...prev.slides];
      [slides[index], slides[target]] = [slides[target], slides[index]];
      return { ...prev, slides };
    });
  }

  async function exportDeck() {
    if (!deck || !deck.slides.length) {
      toast.error("No deck to export yet");
      return;
    }
    setExporting(true);
    try {
      const decorationImages = await Promise.all(
        deck.slides.map(async (slide, i) => {
          const node = slidePreviewRefs.current[i];
          if (!slide.decoration || !node) return undefined;
          try {
            const { toPng } = await import("html-to-image");
            const pixelRatio = node.offsetWidth ? 1280 / node.offsetWidth : 2;
            return await toPng(node, { pixelRatio, skipFonts: true });
          } catch {
            return undefined;
          }
        }),
      );
      const blob = await exportDeckToPptx(deck, decorationImages);
      downloadBlob(blob, `${(deck.title || "Presentation").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}.pptx`);
    } catch (e) {
      toast.error("Couldn't export the presentation");
    } finally {
      setExporting(false);
    }
  }

  const theme = deck ? deckTheme(deck) : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px] p-0 sm:p-6 flex flex-col h-[calc(100dvh-3.5rem)] md:h-dvh">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0 px-3 pt-3 sm:px-0 sm:pt-0">
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 truncate">
            <Presentation className="size-5 shrink-0" /> Presentations
          </h1>
          {(messages.length > 0 || deck) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportDeck} disabled={exporting || !deck}>
                  {exporting ? <Loader2 className="size-4 animate-spin mr-2" /> : <FileDown className="size-4 mr-2" />}
                  Download .pptx
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setMessages([]); setDeck(null); }} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-4 mr-2" /> Clear conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-0 lg:gap-3 flex-1 min-h-0 overflow-hidden">
          <Card className="p-0 flex flex-col flex-1 min-h-0 overflow-hidden lg:max-w-md rounded-none border-x-0 lg:rounded-lg lg:border-x-2">
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-6">
                  <Presentation className="size-10 mb-3 opacity-60" />
                  <p className="text-sm max-w-sm">
                    Describe the deck you need — "a 10-slide pitch deck for an agritech startup" — and I'll build it, with live previews you can edit on the right.
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {m.content || (sending && i === messages.length - 1 ? "" : m.content)}
                  </div>
                </div>
              ))}
              {sending && messages[messages.length - 1]?.content === "" && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Building the deck...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t-2 p-2 sm:p-3 shrink-0 bg-background">
              <Textarea
                rows={1}
                placeholder="Describe the deck or the change you want..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="resize-none min-h-0 border-0 focus-visible:ring-0 shadow-none px-1 py-1 text-base"
              />
              <div className="flex items-center gap-1 mt-1">
                <ChatHistoryMenu
                  tool="presentations"
                  activeId={conversationId}
                  onSelect={handleSelectConversation}
                  onNew={handleNewChat}
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={docFiles.length > 0 || docSummary.trim() !== "" ? "default" : "ghost"} size="sm" className="h-8 gap-1.5 px-2" title="Background docs">
                      <FileStack className="size-4 shrink-0" />
                      <span className="text-xs hidden sm:inline">{docFiles.length > 0 ? `${docFiles.length}` : "Brief / rubric"}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="start" side="top">
                    <h3 className="font-semibold text-sm mb-1">Brief, rubric, or context</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Upload a brief, marking rubric, brand guide, or report so the deck is built around it.
                    </p>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                      <Upload className="size-5 text-muted-foreground" />
                      <span className="text-sm font-medium">Choose documents</span>
                      <span className="text-xs text-muted-foreground">PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), .txt, or .md</span>
                      <input type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.markdown" className="hidden"
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
                        <span className="flex items-center gap-2 truncate text-muted-foreground"><FileText className="size-4 shrink-0" /> Context restored from a previous session</span>
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
                    <Button variant={instructions.trim() ? "default" : "ghost"} size="sm" className="h-8 gap-1.5 px-2 max-w-[180px]" title="Instructions">
                      <ListChecks className="size-4 shrink-0" />
                      <span className="truncate text-xs hidden sm:inline">Instructions</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="start" side="top">
                    <Label className="text-sm font-semibold">Additional instructions</Label>
                    <p className="text-xs text-muted-foreground mt-1 mb-2">
                      Deck type, audience, length, register, anything else to steer the build.
                    </p>
                    <Textarea
                      rows={4}
                      placeholder="e.g. Investor pitch deck, 12 slides, confident and bold."
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                    />
                  </PopoverContent>
                </Popover>

                <div className="ml-auto">
                  <Button onClick={send} disabled={sending || !input.trim()} size="icon" className="size-9">
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-3 sm:p-4 flex-[1.4] min-h-0 overflow-y-auto rounded-none border-x-0 lg:rounded-lg lg:border-x-2">
            {!deck && (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-6">
                <Presentation className="size-10 mb-3 opacity-60" />
                <p className="text-sm max-w-sm">Your slide previews will appear here once you ask for a deck.</p>
              </div>
            )}
            {deck && theme && (
              <div className="space-y-4">
                <Input
                  value={deck.title}
                  onChange={(e) => setDeck({ ...deck, title: e.target.value })}
                  className="text-base font-semibold border-0 shadow-none px-0 focus-visible:ring-0"
                  placeholder="Deck title"
                />
                {deck.slides.map((slide, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Slide {i + 1} · {LAYOUT_LABELS[slide.layout]}</span>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => moveSlide(i, -1)} disabled={i === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                        <button onClick={() => moveSlide(i, 1)} disabled={i === deck.slides.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                        <button onClick={() => duplicateSlide(i)} className="p-1 text-muted-foreground hover:text-foreground"><CopyIcon className="size-3.5" /></button>
                        <button onClick={() => removeSlide(i)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <SlidePreview slide={slide} theme={theme} captureRef={(el) => { slidePreviewRefs.current[i] = el; }} />
                      <SlideEditor slide={slide} onChange={(patch) => updateSlide(i, patch)} />
                    </div>
                  </div>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Plus className="size-3.5" /> Add slide
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(Object.keys(LAYOUT_LABELS) as Slide["layout"][]).map((l) => (
                      <DropdownMenuItem key={l} onClick={() => addSlide(l)}>
                        {LAYOUT_LABELS[l]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
