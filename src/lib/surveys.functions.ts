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

    const prompt = `You are extracting the questions from a survey or interview guide titled "${data.title}".

Source content:
"""
${sourceText}
"""

Your job is to EXTRACT the questions that already exist in the source — not to invent or improve them.

Rules:
- Copy each question's wording VERBATIM from the source. Do not paraphrase, summarize, reword, shorten, merge, or "fix" them. Preserve the exact text, including informal phrasing.
- Keep the questions in the SAME ORDER they appear in the source.
- Interview guides count as questions even when they are not phrased with a "?" — capture prompts and probes such as "Tell me about…", "Describe…", "Walk me through…", "How did you feel when…", and thematic bullet points exactly as written.
- Do NOT add questions that are not in the source. Do NOT drop questions that are in the source.
- For an interview prompt or any free-text question, use type "open_ended". Only use a choice/likert/rating/yes_no type when the source clearly presents fixed answer options, and in that case copy those option labels verbatim into "options".

Output ONLY a valid JSON array (no markdown, no commentary). Each element:
{
  "id": "q1",
  "text": "the exact question text from the source",
  "type": "multiple_choice" | "single_choice" | "open_ended" | "likert" | "matrix" | "yes_no" | "rating",
  "options": ["only when the source lists explicit answer options"],
  "required": true | false
}

ONLY IF the source genuinely contains no questions or prompts at all (e.g. it is empty or unrelated boilerplate), infer 5-10 reasonable questions from the title/topic instead.`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0 });
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
