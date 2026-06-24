import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Bot, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseMarkdownLite, blocksToHtml } from "@/lib/markdown-lite";
import { createAgentSessionFn } from "@/lib/agent-chat.functions";

export const Route = createFileRoute("/_authenticated/app/agent")({
  head: () => ({ meta: [{ title: "Agent · Surveyor" }] }),
  component: AgentPage,
});

type Msg = { role: "user" | "assistant"; content: string };

function AgentPage() {
  const createSession = useServerFn(createAgentSessionFn);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
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
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    try {
      const id = await ensureSession();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/agent-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: id, message: text }),
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
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: raw };
          return copy;
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Sorry, I hit an error — please try again." };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Agent</h1>
            <p className="text-sm text-muted-foreground">
              An open-ended assistant that can analyze data, write, and build presentations end to end — generating
              real .pptx/.xlsx/.docx files when you ask. It doesn't handle Surveys or Interviews — use those tools directly for that.
            </p>
          </div>
        </div>

        <Card className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {starting ? "Starting a session…" : "Ask it to analyze something, write a draft, or build a deck — say what you want, including any files it should produce."}
            </p>
          )}
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={cn("rounded-lg p-3", m.role === "user" ? "bg-muted ml-auto max-w-[80%]" : "bg-background")}>
                {m.content ? (
                  <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: blocksToHtml(parseMarkdownLite(m.content)) }} />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </Card>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask the agent anything…"
            className="min-h-[60px]"
            disabled={sending}
          />
          <Button onClick={send} disabled={sending || !input.trim()} size="icon" className="h-auto">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
