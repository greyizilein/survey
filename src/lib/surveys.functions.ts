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

    const prompt = `You are preparing materials for an interview/survey titled "${data.title}". The pasted source below may contain TWO different kinds of content mixed together:
(A) The actual interview guide / survey questionnaire — the list of questions or prompts to ask.
(B) Supporting background material — written chapters, reports, notes, or other context that is NOT itself a list of questions, but should be used to inform realistic, well-grounded answers.

Source content:
"""
${sourceText}
"""

First, figure out which parts are (A) the guide and which parts are (B) background material. A guide section is recognizable as a list/sequence of distinct questions or interview prompts. Everything else (narrative chapters, descriptions, data, findings) is background material — even if it's the majority of the text.

Then:
1. EXTRACT the questions from the guide portion ONLY. Copy each question's wording VERBATIM — do not paraphrase, summarize, reword, shorten, merge, or "fix" them. Preserve the exact text, including informal phrasing. Keep them in the SAME ORDER they appear. Interview guides count as questions even when not phrased with a "?" — capture prompts and probes such as "Tell me about…", "Describe…", "Walk me through…", and thematic bullet points exactly as written. Do NOT add questions that aren't in the source, and do NOT drop any that are.
   - For an interview prompt or any free-text question, use type "open_ended". Only use a choice/likert/rating/yes_no type when the source clearly presents fixed answer options, and in that case copy those option labels verbatim into "options".
   - ONLY IF the source genuinely contains no questions or prompts at all, infer 5-10 reasonable questions from the title/topic instead.
2. SUMMARIZE the background material portion (if any) into concise bullet points of concrete, reusable facts, themes, and findings that an interviewee's answers should stay consistent with. Leave this empty if there is no background material beyond the guide itself.

Output ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "questions": [
    { "id": "q1", "text": "the exact question text from the source", "type": "multiple_choice" | "single_choice" | "open_ended" | "likert" | "matrix" | "yes_no" | "rating", "options": ["only when the source lists explicit answer options"], "required": true | false }
  ],
  "background_context": "bullet-point summary of background material, or empty string if none"
}`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0 });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse questions");
    let parsed: { questions?: unknown; background_context?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Invalid AI JSON");
    }
    if (!Array.isArray(parsed.questions)) throw new Error("AI response had no questions array");

    const { data: survey, error } = await context.supabase
      .from("surveys")
      .insert({
        user_id: context.userId,
        project_id: data.project_id,
        title: data.title,
        source_type: data.source_type,
        source_url: data.source_url ?? null,
        raw_input: data.raw_input ?? null,
        parsed_questions: parsed.questions as any,
        background_context: parsed.background_context?.trim() || null,
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
