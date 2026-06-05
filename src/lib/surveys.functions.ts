import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ParseInput = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  source_type: z.enum(["text", "url"]),
  source_url: z.string().url().optional(),
  raw_input: z.string().max(50000).optional(),
});

export const parseSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    let sourceText = data.raw_input ?? "";
    if (data.source_type === "url" && data.source_url) {
      try {
        const res = await fetch(data.source_url, { headers: { "User-Agent": "Mozilla/5.0 Surveyor" } });
        const html = await res.text();
        sourceText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 30000);
      } catch (e) {
        sourceText = `URL: ${data.source_url}\n(Could not fetch content. Infer reasonable questions from the URL alone.)`;
      }
    }

    const prompt = `Parse the following survey/interview content into a structured JSON array of questions.

Content:
"""
${sourceText}
"""

Output ONLY a valid JSON array (no markdown). Each element:
{
  "id": "q1",
  "text": "the question text",
  "type": "multiple_choice" | "single_choice" | "open_ended" | "likert" | "matrix" | "yes_no" | "rating",
  "options": ["only for choice/likert types"],
  "required": true | false
}
If the content has no clear questions, infer 5-10 reasonable ones based on the title/topic.`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Could not parse questions");
    let questions: unknown;
    try {
      questions = JSON.parse(match[0]);
    } catch {
      throw new Error("Invalid AI JSON");
    }

    const { data: survey, error } = await context.supabase
      .from("surveys")
      .insert({
        user_id: context.userId,
        project_id: data.project_id,
        title: data.title,
        source_type: data.source_type,
        source_url: data.source_url ?? null,
        raw_input: data.raw_input ?? null,
        parsed_questions: questions as any,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return survey;
  });

export const deleteSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("surveys").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
