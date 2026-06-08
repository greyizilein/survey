import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RunInput = z.object({
  survey_id: z.string().uuid(),
  persona_ids: z.array(z.string().uuid()).min(1).max(25),
});

interface Question {
  id: string;
  text: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface Persona {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  country: string | null;
  city: string | null;
  education: string | null;
  income_bracket: string | null;
  occupation: string | null;
  political_sentiment: string | null;
  core_values: string[] | null;
  language_style: string | null;
  bio: string | null;
}

function personaPrompt(p: Persona) {
  return `You are ${p.name}, age ${p.age ?? "?"}, ${p.gender ?? ""} from ${p.city ?? ""} ${p.country ?? ""}. Education: ${p.education ?? "?"}. Income: ${p.income_bracket ?? "?"}. Occupation: ${p.occupation ?? "?"}. Politics: ${p.political_sentiment ?? "?"}. Values: ${(p.core_values ?? []).join(", ")}. You speak in a ${p.language_style ?? "natural"} style. Backstory: ${p.bio ?? ""}\n\nAnswer authentically as this person would, with their biases, blind spots, and personality.`;
}

export const runSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const { data: survey, error: surveyErr } = await context.supabase
      .from("surveys").select("*").eq("id", data.survey_id).single();
    if (surveyErr || !survey) throw new Error("Survey not found");

    const questions = (survey.parsed_questions as unknown as Question[]) ?? [];
    if (!questions.length) throw new Error("Survey has no questions");

    const { data: personas, error: pErr } = await context.supabase
      .from("personas").select("*").in("id", data.persona_ids);
    if (pErr || !personas) throw new Error("Personas not found");

    const { data: sim, error: simErr } = await context.supabase
      .from("simulations")
      .insert({
        user_id: context.userId,
        survey_id: data.survey_id,
        status: "running",
        total_personas: personas.length,
      })
      .select().single();
    if (simErr || !sim) throw new Error("Could not create simulation");

    const questionList = questions.map((q, i) => `${i + 1}. [${q.type}] ${q.text}${q.options?.length ? ` (Options: ${q.options.join(" | ")})` : ""}`).join("\n");

    // Process in small parallel batches
    const responses: Array<{ persona_id: string; answers: unknown }> = [];
    const BATCH = 5;
    for (let i = 0; i < personas.length; i += BATCH) {
      const batch = personas.slice(i, i + BATCH) as Persona[];
      const results = await Promise.all(batch.map(async (p) => {
        const prompt = `${personaPrompt(p)}\n\nAnswer these ${questions.length} survey questions:\n${questionList}\n\nOutput ONLY a valid JSON array, one element per question in order:\n[{"question_id":"q1","answer":"your answer here"}]\nFor choice questions answer with one option text. For open-ended give a 1-3 sentence authentic response. For likert/rating give a number 1-5.`;
        try {
          const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
          const m = text.match(/\[[\s\S]*\]/);
          const answers = m ? JSON.parse(m[0]) : fallbackAnswers(questions, p);
          return { persona_id: p.id, answers: normalizeAnswers(answers, questions, p) };
        } catch {
          return { persona_id: p.id, answers: fallbackAnswers(questions, p) };
        }
      }));
      responses.push(...results);
    }

    const rows = responses.map((r) => ({
      simulation_id: sim.id,
      persona_id: r.persona_id,
      user_id: context.userId,
      answers: r.answers as any,
    }));
    const { error: responseErr } = await context.supabase.from("responses").insert(rows);
    if (responseErr) throw new Error(responseErr.message);
    await context.supabase
      .from("simulations")
      .update({ status: "complete", completed_count: rows.length })
      .eq("id", sim.id);

    return { simulation_id: sim.id, count: rows.length };
  });

export const getSimulationResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { simulation_id: string }) => z.object({ simulation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("responses")
      .select("*, personas(name, age, gender, country, occupation)")
      .eq("simulation_id", data.simulation_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const generateVtt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    survey_id: z.string().uuid(),
    persona_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const { data: survey } = await context.supabase.from("surveys").select("*").eq("id", data.survey_id).single();
    const { data: persona } = await context.supabase.from("personas").select("*").eq("id", data.persona_id).single();
    if (!survey || !persona) throw new Error("Not found");

    const questions = (survey.parsed_questions as unknown as Question[]) ?? [];
    const qList = questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n");

    const prompt = `${personaPrompt(persona as Persona)}\n\nYou are being interviewed about: "${survey.title}". The interviewer (Researcher) will ask these questions:\n${qList}\n\nWrite a realistic interview transcript. Use natural conversational filler ("um", "uh", "like", "you know", "I mean") and brief pauses. Each turn should feel spontaneous. Format as alternating lines:\nResearcher: ...\n${persona.name}: ...\n\nReturn ONLY the transcript text, no preamble. Keep total response under 1500 words.`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });

    // Convert transcript to VTT with simulated timestamps
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let t = 0;
    const cues: string[] = ["WEBVTT", ""];
    for (const line of lines) {
      const wordCount = line.split(/\s+/).length;
      const duration = Math.max(2, Math.min(12, wordCount * 0.38)); // ~155 wpm
      const start = formatTime(t);
      const end = formatTime(t + duration);
      cues.push(`${start} --> ${end}`);
      cues.push(line);
      cues.push("");
      t += duration + 0.4; // small pause
    }
    const vtt = cues.join("\n");

    const { data: tr, error } = await context.supabase
      .from("transcripts")
      .insert({
        user_id: context.userId,
        survey_id: data.survey_id,
        persona_id: data.persona_id,
        vtt_content: vtt,
      })
      .select().single();
    if (error) throw new Error(error.message);
    return tr;
  });

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function normalizeAnswers(answers: unknown, questions: Question[], persona: Persona) {
  if (!Array.isArray(answers)) return fallbackAnswers(questions, persona);
  const byId = new Map(answers.map((item: any) => [String(item?.question_id ?? ""), item?.answer]));
  return questions.map((question) => ({
    question_id: question.id,
    answer: byId.has(question.id) ? byId.get(question.id) : fallbackAnswer(question, persona),
  }));
}

function fallbackAnswers(questions: Question[], persona: Persona) {
  return questions.map((question) => ({ question_id: question.id, answer: fallbackAnswer(question, persona) }));
}

function fallbackAnswer(question: Question, persona: Persona) {
  if (question.options?.length) return question.options[Math.abs(hash(`${persona.id}-${question.id}`)) % question.options.length];
  if (question.type === "rating" || question.type === "likert") return 3 + (Math.abs(hash(`${persona.name}-${question.text}`)) % 3) - 1;
  if (question.type === "yes_no") return Math.abs(hash(`${question.id}-${persona.country}`)) % 2 === 0 ? "Yes" : "No";
  const place = [persona.city, persona.country].filter(Boolean).join(", ") || "my community";
  return `From my perspective as ${persona.occupation ?? "someone with my background"} in ${place}, ${question.text.toLowerCase().replace(/[?]+$/, "")} depends on trust, cost, and whether it fits my day-to-day life.`;
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(31, h) + value.charCodeAt(i);
  return h;
}
