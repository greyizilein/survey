import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100000),
});

const SlideSchema = z.object({
  layout: z.enum(["title", "section", "bullets", "two-column", "stat", "quote", "timeline", "grid", "table", "closing"]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  number: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  body: z.string().optional(),
  columns: z.array(z.object({ heading: z.string(), bullets: z.array(z.string()) })).optional(),
  value: z.string().optional(),
  label: z.string().optional(),
  quote: z.string().optional(),
  author: z.string().optional(),
  stages: z.array(z.object({ label: z.string(), title: z.string(), done: z.boolean().optional() })).optional(),
  items: z.array(z.object({ label: z.string(), color: z.string().optional(), bullets: z.array(z.string()) })).optional(),
  tableColumns: z.array(z.string()).optional(),
  tableRows: z.array(z.array(z.string())).optional(),
  notes: z.string().optional(),
});

const ThemeSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  dark: z.string(),
  light: z.string(),
});

export const DeckSchema = z.object({
  title: z.string(),
  theme: ThemeSchema.optional(),
  slides: z.array(SlideSchema).min(1).max(40),
});

export const PresentationChatInput = z.object({
  messages: z.array(ChatMessage).min(1).max(40),
  background: z.string().max(8000).optional(),
  instructions: z.string().max(4000).optional(),
  currentDeck: DeckSchema.optional(),
});

const DocFile = z.object({ name: z.string().max(200), data: z.string() });
const SummarizeDocsInput = z.object({ files: z.array(DocFile).min(1).max(8) });

export const summarizePresentationDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummarizeDocsInput.parse(d))
  .handler(async ({ data }) => {
    const { extractText } = await import("./interviews.functions");
    const texts: string[] = [];
    for (const f of data.files) {
      const t = await extractText(f.data, f.name);
      texts.push(`===== FILE: ${f.name} =====\n${t}`);
    }
    let combined = texts.join("\n\n");
    const MAX = 50_000;
    if (combined.length > MAX) combined = combined.slice(0, MAX) + "\n…[truncated]";

    const RAW_PASSTHROUGH_LIMIT = 7800;
    if (combined.length <= RAW_PASSTHROUGH_LIMIT) {
      return { summary: combined.trim() };
    }

    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const prompt = `Condense the following material (a brief, rubric, brand guide, report, or reference document) into background context for building a presentation deck from it. Preserve every distinct requirement, fact, theme, deadline, audience note, and structural constraint — if the source describes a rubric or marking criteria, preserve every criterion exactly; if it describes several distinct briefs or decks, enumerate all of them separately rather than merging them.

Source content:
"""
${combined}
"""

Output ONLY the condensed summary as plain text, no markdown headers, no commentary.`;
    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0 });
    return { summary: text.trim() };
  });

export async function buildPresentationPrompt(
  data: z.infer<typeof PresentationChatInput>,
): Promise<{ model: string; prompt: string }> {
  const { DEFAULT_MODEL } = await import("./ai-gateway.server");
  const { PRESENTATION_STUDIO_TEMPLATE } = await import("./presentation-templates.server");

  const history = data.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");

  const backgroundBlock = data.background?.trim()
    ? `\n\nUPLOADED BRIEF / RUBRIC / CONTEXT (use this to understand the audience, requirements, and subject matter):\n${data.background.trim()}`
    : "\n\nNo brief, rubric, or context document has been uploaded.";

  const instructionsBlock = data.instructions?.trim()
    ? `\n\nADDITIONAL INSTRUCTIONS (follow these when shaping tone, scope, and length):\n${data.instructions.trim()}`
    : "";

  const currentDeckBlock = data.currentDeck
    ? `\n\nCURRENT DECK STATE (the deck as it exists right now, including any manual edits the user has made in the editor):\n${JSON.stringify(data.currentDeck)}`
    : "\n\nCURRENT DECK STATE: none yet — this is the first deck for this conversation.";

  const prompt = `${PRESENTATION_STUDIO_TEMPLATE}

${backgroundBlock}${instructionsBlock}${currentDeckBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message per the workflow and JSON deck schema above.`;

  return { model: DEFAULT_MODEL, prompt };
}
