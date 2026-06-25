import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ParseInput = z.object({
  plainText: z.string().max(50000).optional(),
  docxBase64: z.string().max(15_000_000).optional(),
  filename: z.string().max(200).optional(),
});

const FeedbackItemSchema = z.object({
  type: z.enum(["comment", "insertion", "deletion", "note"]),
  comment: z.string(),
  target_excerpt: z.string().optional(),
  suggested_replacement: z.string().optional(),
  author: z.string().optional(),
});

export const parseSupervisorFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data }) => {
    let text = data.plainText ?? "";
    if (data.docxBase64) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(data.docxBase64, "base64") });
      text = result.value;
    }
    text = text.trim();
    if (!text) throw new Error("No feedback text found");

    const { createAi, textModelForTier } = await import("./ai-gateway.server");
    const { generateObject } = await import("ai");
    const ai = createAi();

    const prompt = `You are extracting actionable feedback items from a supervisor's/reviewer's comments on a piece of writing. Read the following feedback text and break it into discrete, individually-actionable items.

For each item, classify it as:
- "comment" — an instruction tied to a specific passage (rewrite, compress, expand, re-argue it)
- "insertion" — new content the supervisor wants added somewhere
- "deletion" — content the supervisor wants removed
- "note" — a general, document-wide instruction (e.g. "use past tense throughout", "tighten the introduction")

For "comment" and "deletion" items, include target_excerpt — the exact (or closely paraphrased) passage from the document being referred to, if it's identifiable from the feedback text. Include suggested_replacement when the feedback proposes specific replacement wording. Include author if a name is attached to the feedback.

FEEDBACK TEXT:
"""
${text}
"""

Extract every distinct actionable item — do not merge unrelated instructions, and do not invent items the text doesn't support.`;

    const { object } = await generateObject({
      model: ai(textModelForTier()),
      schema: z.object({ items: z.array(FeedbackItemSchema) }),
      prompt,
      temperature: 0,
    });

    return { items: object.items.map((it, i) => ({ id: `fb-${i}`, ...it })) };
  });
