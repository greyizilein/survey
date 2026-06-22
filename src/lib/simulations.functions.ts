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
    const backgroundBlock = survey.background_context
      ? `\n\nBackground material for this survey (use it to ground your answers in consistent, concrete facts/themes where relevant — but still answer as yourself, in your own voice):\n${survey.background_context}`
      : "";

    // Process in small parallel batches
    const responses: Array<{ persona_id: string; answers: unknown }> = [];
    const BATCH = 5;
    for (let i = 0; i < personas.length; i += BATCH) {
      const batch = personas.slice(i, i + BATCH) as Persona[];
      const results = await Promise.all(batch.map(async (p) => {
        const prompt = `${personaPrompt(p)}${backgroundBlock}\n\nAnswer these ${questions.length} survey questions:\n${questionList}\n\nOutput ONLY a valid JSON array, one element per question in order:\n[{"question_id":"q1","answer":"your answer here"}]\nFor choice questions answer with one option text. For open-ended give a 1-3 sentence authentic response. For likert/rating give a number 1-5.`;
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

const UpdateAnswerInput = z.object({
  response_id: z.string().uuid(),
  question_id: z.string(),
  answer: z.string(),
});

export const updateResponseAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateAnswerInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error: fetchErr } = await context.supabase
      .from("responses").select("answers").eq("id", data.response_id).single();
    if (fetchErr || !row) throw new Error("Response not found");

    const answers = (Array.isArray(row.answers) ? row.answers : []) as Array<{ question_id: string; answer: unknown }>;
    const next = answers.some((a) => a.question_id === data.question_id)
      ? answers.map((a) => (a.question_id === data.question_id ? { ...a, answer: data.answer } : a))
      : [...answers, { question_id: data.question_id, answer: data.answer }];

    const { error } = await context.supabase.from("responses").update({ answers: next as any }).eq("id", data.response_id);
    if (error) throw new Error(error.message);
    return { ok: true };
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

    // Interviewer name: survey metadata (user-entered or AI-detected) first, then the signed-in user's profile.
    const { data: profile } = await context.supabase
      .from("profiles").select("display_name").eq("id", context.userId).single();
    const interviewerName = survey.interviewer_name?.trim() || profile?.display_name?.trim() || "Researcher";
    const interviewerAffiliation = survey.interviewer_affiliation?.trim() || "";
    const participantName = (persona.name as string)?.trim() || "Participant";

    const backgroundBlock = survey.background_context
      ? `\n\nBackground material for this study (use it to ground ${participantName}'s answers in consistent, concrete facts/themes where relevant — but still answer in character, in their own voice):\n${survey.background_context}`
      : "";

    const prompt = `You are scripting a realistic, one-to-one qualitative research interview conducted over Zoom for a study titled "${survey.title}".

INTERVIEWER (the researcher): ${interviewerName}${interviewerAffiliation ? ` — ${interviewerAffiliation}` : ""}
PARTICIPANT (answers fully in character as this person): ${participantName}
${personaPrompt(persona as Persona)}${backgroundBlock}

The interviewer MUST ask exactly these guide questions, in this order, preserving their wording (light natural lead-ins like "Okay, next —" are fine, but do not change what is being asked). Do not skip, merge, reorder, or invent additional main questions; brief natural clarifying follow-ups are allowed:
${qList}

Produce the FULL interview as a JSON array of turns. Each turn is {"speaker": string, "text": string}. Use these EXACT speaker names: the interviewer is "${interviewerName}" and the participant is "${participantName}".

Structure the interview like a real ethics-compliant research session:
1. Brief greeting and an audio check.
2. An ethics/consent preamble delivered by the interviewer (it can span a couple of turns): introduce themselves${interviewerAffiliation ? ` and their affiliation (${interviewerAffiliation})` : ""} and the study; confidentiality and use of a pseudonym; that nothing said will be shared with the participant's manager/headteacher/anyone at their organisation; that participation is voluntary with the right to skip questions or stop at any time; approximate duration; ask for consent to audio-record; and confirm the participant is alone and has read/signed the consent form. The participant gives short, natural confirmations.
3. The guide questions, each asked in order and each followed by an in-character answer. Use natural conversational fillers ("um", "like", "you know", "I mean"), occasional [pause], and realistic answer lengths (often 2-6 sentences, longer where natural). Keep everything consistent with the participant's background${survey.background_context ? " and the background material above" : ""}.
4. A closing: the interviewer thanks the participant, restates confidentiality, offers to share the final work, and asks if they have any questions; the participant responds; the interviewer ends the recording.

Write in the participant's natural voice and dialect where appropriate. Return ONLY the JSON array, no markdown fences, no commentary.`;

    const { text } = await generateText({
      model: ai(DEFAULT_MODEL),
      prompt,
      temperature: 0.7,
      maxOutputTokens: 12000,
    });

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Could not generate transcript — please try again");
    let turns: Array<{ speaker?: string; text?: string }>;
    try {
      turns = JSON.parse(match[0]);
    } catch {
      throw new Error("Transcript came back malformed — please try again");
    }
    turns = (Array.isArray(turns) ? turns : []).filter((t) => t && typeof t.text === "string" && t.text.trim());
    if (!turns.length) throw new Error("Transcript was empty — please try again");

    // Build a Zoom-style WebVTT where each cue payload is a JSON object with speaker + timing metadata.
    const base = new Date();
    base.setUTCMilliseconds(700);
    let t = 0.7;
    const cues: string[] = ["WEBVTT", ""];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const speakerName = turn.speaker?.trim() || (i % 2 === 0 ? interviewerName : participantName);
      const spokenText = turn.text!.trim();
      const wordCount = spokenText.split(/\s+/).length;
      const duration = Math.max(2, Math.min(120, wordCount * 0.38)); // ~155 wpm, capped for long monologues
      const startSec = t;
      const endSec = t + duration;
      cues.push(`${formatTime(startSec)} --> ${formatTime(endSec)}`);
      cues.push(JSON.stringify({
        startDateTime: formatIsoZoom(new Date(base.getTime() + startSec * 1000)),
        endDateTime: formatIsoZoom(new Date(base.getTime() + endSec * 1000)),
        speakerName,
        spokenText,
        spokenLanguage: "en-us",
      }));
      cues.push("");
      t = endSec + 0.7; // small gap between turns
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

// Matches the datetime format Zoom/Teams emit in VTT cue payloads, e.g. 2026-06-03T14:00:00.7000000+00:00
function formatIsoZoom(date: Date): string {
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const frac = String(date.getUTCMilliseconds()).padStart(3, "0") + "0000"; // 7 fractional digits
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${frac}+00:00`;
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
