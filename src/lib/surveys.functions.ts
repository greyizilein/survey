import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ParseInput = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  source_type: z.enum(["text", "url"]),
  source_url: z.string().url().optional(),
  raw_input: z.string().max(50000).optional(),
  context_input: z.string().max(50000).optional(),
  interviewer_name: z.string().max(200).optional(),
  interviewer_affiliation: z.string().max(300).optional(),
});

export const parseSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    let guideText = data.raw_input ?? "";
    if (data.source_type === "url" && data.source_url) {
      try {
        const res = await fetch(data.source_url, { headers: { "User-Agent": "Mozilla/5.0 Surveyor" } });
        const html = await res.text();
        guideText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 30000);
      } catch (e) {
        guideText = `URL: ${data.source_url}\n(Could not fetch content. Infer reasonable questions from the URL alone.)`;
      }
    }
    const contextText = data.context_input?.trim() ?? "";

    const guidePrompt = `You are extracting the interview/survey guide for "${data.title}". The source below IS the interview guide / survey questionnaire — every part of it is in scope for question extraction.

Source content:
"""
${guideText}
"""

1. EXTRACT every question and prompt in this guide. Copy each one's wording VERBATIM — do not paraphrase, summarize, reword, shorten, merge, or "fix" them. Preserve the exact text, including informal phrasing. Keep them in the SAME ORDER they appear. Prompts and probes such as "Tell me about…", "Describe…", "Walk me through…", and thematic bullet points count as questions exactly as written. Do NOT add questions that aren't in the source, and do NOT drop any that are.
   - For an interview prompt or any free-text question, use type "open_ended". Only use a choice/likert/rating/yes_no type when the source clearly presents fixed answer options, and in that case copy those option labels verbatim into "options".
   - ONLY IF the source genuinely contains no questions or prompts at all, infer 5-10 reasonable questions from the title/topic instead.
2. DETECT interview metadata if it is stated anywhere in the source: the interviewer/researcher's name, and their affiliation (e.g. their university, programme, department, or organisation). Interview guides often open with something like "My name is …, I am a … at the University of …". Return empty strings for anything not clearly stated — do NOT guess or invent names.

Output ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "questions": [
    { "id": "q1", "text": "the exact question text from the source", "type": "multiple_choice" | "single_choice" | "open_ended" | "likert" | "matrix" | "yes_no" | "rating", "options": ["only when the source lists explicit answer options"], "required": true | false }
  ],
  "interviewer_name": "detected researcher name, or empty string",
  "interviewer_affiliation": "detected affiliation/institution/programme, or empty string"
}`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt: guidePrompt, temperature: 0 });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse questions");
    let parsed: { questions?: unknown; interviewer_name?: string; interviewer_affiliation?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Invalid AI JSON");
    }
    if (!Array.isArray(parsed.questions)) throw new Error("AI response had no questions array");

    let backgroundContext: string | null = null;
    if (contextText) {
      const contextPrompt = `Summarize the following written material (background chapters, reports, notes) into concise bullet points of concrete, reusable facts, themes, and findings that an interviewee's answers for a study titled "${data.title}" should stay consistent with. This material does NOT contain interview questions to ask — only background context.

Source content:
"""
${contextText}
"""

Output ONLY the bullet-point summary as plain text, no markdown headers, no commentary.`;
      const { text: contextSummary } = await generateText({ model: ai(DEFAULT_MODEL), prompt: contextPrompt, temperature: 0 });
      backgroundContext = contextSummary.trim() || null;
    }

    // User-supplied values win; otherwise fall back to what the AI detected in the guide.
    const interviewerName = data.interviewer_name?.trim() || parsed.interviewer_name?.trim() || null;
    const interviewerAffiliation = data.interviewer_affiliation?.trim() || parsed.interviewer_affiliation?.trim() || null;

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
        background_context: backgroundContext,
        interviewer_name: interviewerName,
        interviewer_affiliation: interviewerAffiliation,
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
