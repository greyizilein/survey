import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types shared with the UI
// ---------------------------------------------------------------------------
export interface GuideQuestion {
  id: string;
  text: string;
}
export interface InterviewTurn {
  speaker: string;
  role: "interviewer" | "respondent";
  text: string;
}
export interface ParticipantPersona {
  name: string;
  age: number | null;
  gender: string | null;
  role_context: string | null; // their relationship to the study topic
  background: string | null;
  voice: string | null; // how they speak — register, pace, verbal tics
  stance: string | null; // their attitude / perspective on the topic
}

// Overused names the AI keeps defaulting to — explicitly banned so transcripts
// don't all sound like the same three people.
const BLOCKED_NAMES = [
  "chidi", "adaeze", "obi", "emeka", "ngozi", "amaka", "chioma", "ifeoma",
  "tunde", "bola", "ada", "uche", "nneka", "kemi", "yetunde", "chinedu",
];

// ---------------------------------------------------------------------------
// Document extraction (runs on the server; client sends base64 + filename)
// ---------------------------------------------------------------------------
export async function extractText(base64: string, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const bytes = Buffer.from(base64, "base64");

  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "csv") {
    return bytes.toString("utf-8");
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  }
  if (ext === "pdf") {
    const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractPdf(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (ext === "doc") {
    throw new Error("Legacy .doc files aren't supported. Please re-save as .docx or PDF and upload again.");
  }
  // Fall back to a best-effort UTF-8 decode for unknown text-like formats.
  return bytes.toString("utf-8");
}

function safeJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — analyze uploaded documents (the "confirm before generating" step)
// ---------------------------------------------------------------------------
const AnalyzeInput = z.object({
  guide_files: z
    .array(z.object({ name: z.string(), data: z.string() }))
    .min(1)
    .max(8),
  context_files: z
    .array(z.object({ name: z.string(), data: z.string() }))
    .max(8)
    .optional(),
  notes: z.string().max(2000).optional(),
});

export const analyzeInterviewDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data }) => {
    async function gather(files: { name: string; data: string }[]) {
      const out: string[] = [];
      for (const f of files) {
        const t = await extractText(f.data, f.name);
        out.push(`===== FILE: ${f.name} =====\n${t}`);
      }
      return out.join("\n\n");
    }

    let guideText = await gather(data.guide_files);
    let contextText = data.context_files?.length ? await gather(data.context_files) : "";
    // Keep the prompt within sane bounds.
    const GUIDE_MAX = 25_000;
    const CONTEXT_MAX = 45_000;
    if (guideText.length > GUIDE_MAX) guideText = guideText.slice(0, GUIDE_MAX) + "\n…[truncated]";
    if (contextText.length > CONTEXT_MAX) contextText = contextText.slice(0, CONTEXT_MAX) + "\n…[truncated]";

    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const prompt = `You are helping a qualitative researcher set up simulated interviews. They have given you TWO clearly separated kinds of material.

THE INTERVIEW GUIDE (this is the ONLY source of the questions to ask — every question must come from here, verbatim, in order):
"""
${guideText}
"""

${contextText ? `BACKGROUND / CONTEXT MATERIAL (methodology, chapters, literature — use ONLY to understand the study, the sample size, and the participant population. NEVER take interview questions from here):
"""
${contextText}
"""
` : ""}${data.notes ? `RESEARCHER NOTES\n${data.notes}\n` : ""}
Return ONLY a JSON object with this exact shape:
{
  "title": "a concise study title inferred from the materials",
  "context_summary": "3-5 sentences describing the study topic, setting, and what kind of people are being interviewed",
  "respondent_count": <integer the methodology calls for, or your best estimate>,
  "count_evidence": "the exact sentence or phrase from the materials that states the sample size, or 'No explicit number found — estimated from study design.'",
  "guide_questions": ["each interview question, taken VERBATIM from THE INTERVIEW GUIDE only, in order"],
  "naming_context": "describe the realistic naming pool for participants — the specific region, ethnicities, generation, and profession involved, so generated names fit the real population (NOT a generic set). Be specific."
}

Rules:
- guide_questions MUST come exclusively from THE INTERVIEW GUIDE section. Do NOT pull "research questions", aims, or objectives out of the background/context material — those are not interview questions.
- Copy each guide question verbatim and keep the original order. Capture prompts/probes ("Tell me about…", "Describe…") exactly as written. Do NOT invent or drop questions. Only if the guide is genuinely empty of questions, infer the 6-12 most likely ones from the topic.
- If the materials name a sample size (e.g. "18 semi-structured interviews"), use that exact number and quote it in count_evidence; otherwise estimate and say so.`;

    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0 });
    const parsed = safeJson<{
      title?: string;
      context_summary?: string;
      respondent_count?: number;
      count_evidence?: string;
      guide_questions?: string[];
      naming_context?: string;
    }>(text, {});

    const questions: GuideQuestion[] = (parsed.guide_questions ?? [])
      .filter((q) => typeof q === "string" && q.trim())
      .map((q, i) => ({ id: `q${i + 1}`, text: String(q).trim() }));

    let count = Number(parsed.respondent_count);
    if (!Number.isFinite(count) || count < 1) count = 12;
    count = Math.min(60, Math.max(1, Math.round(count)));

    return {
      title: parsed.title?.trim() || "Untitled study",
      context_summary: parsed.context_summary?.trim() || "",
      respondent_count: count,
      count_evidence: parsed.count_evidence?.trim() || "No explicit number found — estimated from study design.",
      guide_questions: questions,
      naming_context: parsed.naming_context?.trim() || "",
      source_excerpt: (contextText || guideText).slice(0, 8000),
    };
  });

// ---------------------------------------------------------------------------
// Step 2 — create the study + plan N distinct participants (no transcripts yet)
// ---------------------------------------------------------------------------
const CreateStudyInput = z.object({
  title: z.string().min(1).max(200),
  interviewer_name: z.string().min(1).max(120),
  interview_mode: z.enum(["teams", "zoom", "in_person"]).default("teams"),
  date_start: z.string().optional(),
  date_end: z.string().optional(),
  context_summary: z.string().max(4000).optional(),
  brief: z.string().max(2000).optional(),
  naming_context: z.string().max(2000).optional(),
  source_excerpt: z.string().max(20000).optional(),
  guide_questions: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
  respondent_count: z.number().int().min(1).max(60),
  anonymize: z.boolean().default(false),
  depth: z.enum(["brief", "standard", "in_depth"]).default("standard"),
});

async function planParticipants(
  count: number,
  context: string,
  namingContext: string,
): Promise<ParticipantPersona[]> {
  const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  const ai = createAi();

  const prompt = `Design ${count} distinct interview participants for a qualitative study. They must feel like ${count} different real people who would genuinely be recruited for this study.

STUDY CONTEXT
${context}

NAMING GUIDANCE (follow precisely)
${namingContext || "Use names that authentically fit the specific population, region, and profession in the study context."}

HARD NAMING RULES
- Every name (given + surname) must realistically belong to the actual population described — match the real ethnic, regional, and generational mix of that group.
- All ${count} names must be UNIQUE. No repeats, no near-duplicates.
- Do NOT use any of these overused names: ${BLOCKED_NAMES.join(", ")}.
- Vary surnames too — do not reuse one surname across participants.
- Spread ages, genders, and perspectives realistically across the group.

Return ONLY a JSON array of exactly ${count} objects:
[{
  "name": "full name (given + surname)",
  "age": <integer>,
  "gender": "their gender",
  "role_context": "their specific relationship to the study topic (e.g. '6 years teaching primary maths in an under-resourced school')",
  "background": "2-3 sentences of relevant lived experience that shapes their views",
  "voice": "how they actually speak — register, pace, hesitations, verbal habits, vocabulary",
  "stance": "their genuine attitude toward the study topic — make these differ across the group, including skeptics and enthusiasts"
}]`;

  const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0.9 });
  const arr = safeJson<any[]>(text, []);

  const seen = new Set<string>();
  const people: ParticipantPersona[] = [];
  for (const p of Array.isArray(arr) ? arr : []) {
    let name = String(p?.name ?? "").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    // Skip blocked first names and any duplicate.
    const first = lower.split(/\s+/)[0];
    if (BLOCKED_NAMES.includes(first)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    const age = Number(p?.age);
    people.push({
      name,
      age: Number.isFinite(age) ? age : null,
      gender: p?.gender ? String(p.gender) : null,
      role_context: p?.role_context ? String(p.role_context) : null,
      background: p?.background ? String(p.background) : null,
      voice: p?.voice ? String(p.voice) : null,
      stance: p?.stance ? String(p.stance) : null,
    });
  }
  return people.slice(0, count);
}

// Spread interview datetimes across the chosen range, on weekday business hours.
function scheduleDates(count: number, start?: string, end?: string): string[] {
  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 14 * 86_400_000);
  const span = Math.max(0, endDate.getTime() - startDate.getTime());
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const frac = count > 1 ? i / (count - 1) : 0;
    const jitter = (Math.random() - 0.5) * (span / Math.max(count, 1));
    const d = new Date(startDate.getTime() + frac * span + jitter);
    // Pull weekends onto Friday and clamp to 9:00–16:30 local-ish.
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2);
    if (day === 6) d.setDate(d.getDate() - 1);
    d.setHours(9 + Math.floor(Math.random() * 8), [0, 15, 30, 45][Math.floor(Math.random() * 4)], 0, 0);
    out.push(d.toISOString());
  }
  return out.sort();
}

export const createInterviewStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateStudyInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;

    const { data: study, error } = await supabase
      .from("interview_studies")
      .insert({
        user_id: context.userId,
        title: data.title,
        interviewer_name: data.interviewer_name,
        interview_mode: data.interview_mode,
        date_start: data.date_start || null,
        date_end: data.date_end || null,
        context_summary: data.context_summary || null,
        brief: data.brief || null,
        naming_context: data.naming_context || null,
        guide_questions: data.guide_questions,
        respondent_count: data.respondent_count,
        anonymize: data.anonymize,
        depth: data.depth,
        source_excerpt: data.source_excerpt || null,
        status: "generating",
      })
      .select()
      .single();
    if (error || !study) throw new Error(error?.message ?? "Could not create study");

    const contextText = [data.context_summary, data.brief].filter(Boolean).join("\n\n");
    const people = await planParticipants(data.respondent_count, contextText, data.naming_context ?? "");
    const dates = scheduleDates(people.length, data.date_start, data.date_end);

    const rows = people.map((p, i) => ({
      study_id: study.id,
      user_id: context.userId,
      ordinal: i + 1,
      participant_label: data.anonymize ? `P${String(i + 1).padStart(2, "0")}` : p.name,
      display_name: p.name,
      persona: p,
      interview_date: dates[i] ?? null,
      turns: [],
      status: "pending",
    }));

    const { data: inserted, error: pErr } = await supabase
      .from("interview_participants")
      .insert(rows)
      .select("*");
    if (pErr) throw new Error(pErr.message);

    return { study, participants: inserted ?? [] };
  });

// ---------------------------------------------------------------------------
// Step 3 — generate ONE participant's full transcript (client orchestrates N)
// ---------------------------------------------------------------------------
const GenInput = z.object({ participant_id: z.string().uuid() });

const DEPTH_GUIDE: Record<string, string> = {
  brief: "Keep it focused: roughly 12-16 total speaking turns. Cover the core guide questions with 1 light follow-up each.",
  standard: "A natural full interview: roughly 22-30 total speaking turns. Ask each guide question and probe with 1-2 organic follow-ups where the answer invites it.",
  in_depth: "A rich, in-depth interview: roughly 36-50 total speaking turns. Explore each guide question thoroughly with multiple follow-ups, clarifications, and the occasional tangent that real interviews have.",
};

export const generateTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;

    const { data: participant, error: pErr } = await supabase
      .from("interview_participants")
      .select("*")
      .eq("id", data.participant_id)
      .eq("user_id", context.userId)
      .single();
    if (pErr || !participant) throw new Error(pErr?.message ?? "Participant not found");

    const { data: study, error: sErr } = await supabase
      .from("interview_studies")
      .select("*")
      .eq("id", participant.study_id)
      .single();
    if (sErr || !study) throw new Error(sErr?.message ?? "Study not found");

    const persona = participant.persona as ParticipantPersona;
    const guide: GuideQuestion[] = study.guide_questions ?? [];
    const guideText = guide.map((q, i) => `${i + 1}. ${q.text}`).join("\n");
    const respondentName = study.anonymize ? participant.participant_label : persona.name;
    const interviewerName = study.interviewer_name;

    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const prompt = `Produce a realistic verbatim transcript of a one-on-one qualitative research interview. It must read exactly like a genuine recording — natural speech, hesitations ("um", "I mean", "you know"), self-corrections, and warmth. NOT a polished Q&A.

THE INTERVIEWER
Name: ${interviewerName}. Professional, warm, curious. Asks the guide questions in a natural order, acknowledges answers briefly, and asks organic follow-ups based on what the respondent actually says.

THE RESPONDENT (speak entirely in character — this is one consistent person)
Name to use as speaker label: ${respondentName}
Age: ${persona.age ?? "unspecified"}. Gender: ${persona.gender ?? "unspecified"}.
Relationship to topic: ${persona.role_context ?? "unspecified"}
Background: ${persona.background ?? "unspecified"}
How they speak: ${persona.voice ?? "natural, conversational"}
Their stance on the topic: ${persona.stance ?? "balanced"}

STUDY CONTEXT
${study.context_summary ?? ""}

INTERVIEW GUIDE (cover all of these, in a natural flow)
${guideText}

LENGTH & DEPTH
${DEPTH_GUIDE[study.depth] ?? DEPTH_GUIDE.standard}

RULES
- Open with a brief, natural greeting and a line about consent/recording, like real interviews.
- The respondent answers from their specific lived experience — concrete, opinionated, sometimes uncertain. Different respondents would answer differently; this is THIS person.
- Vary turn lengths. Some respondent answers are long and rambling, some short. The interviewer's turns are usually short.
- Close naturally (thanks, anything to add, goodbye).
- Do NOT include timestamps, headers, markdown, or any narration. ONLY the dialogue turns.

Return ONLY a JSON array of turns:
[{"speaker":"${interviewerName}","role":"interviewer","text":"..."},{"speaker":"${respondentName}","role":"respondent","text":"..."}]`;

    let turns: InterviewTurn[] = [];
    try {
      const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0.85 });
      const arr = safeJson<any[]>(text, []);
      turns = (Array.isArray(arr) ? arr : [])
        .filter((t) => t && typeof t.text === "string" && t.text.trim())
        .map((t) => ({
          speaker: t.role === "interviewer" ? interviewerName : respondentName,
          role: t.role === "interviewer" ? "interviewer" : "respondent",
          text: String(t.text).trim(),
        }));
    } catch {
      turns = [];
    }

    if (!turns.length) {
      const { error } = await supabase
        .from("interview_participants")
        .update({ status: "error" })
        .eq("id", participant.id);
      if (error) throw new Error(error.message);
      throw new Error("The model returned no usable transcript. Try again.");
    }

    const { data: updated, error: uErr } = await supabase
      .from("interview_participants")
      .update({ turns, status: "done" })
      .eq("id", participant.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);

    // Flip the study to complete once every participant is done.
    const { count: pending } = await supabase
      .from("interview_participants")
      .select("*", { count: "exact", head: true })
      .eq("study_id", study.id)
      .neq("status", "done");
    if (!pending) {
      await supabase.from("interview_studies").update({ status: "complete" }).eq("id", study.id);
    }

    return updated;
  });

// ---------------------------------------------------------------------------
// Listing / fetching / deleting
// ---------------------------------------------------------------------------
export const listInterviewStudies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data, error } = await supabase
      .from("interview_studies")
      .select("*, interview_participants(count)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((s: any) => ({
      ...s,
      participant_count: s.interview_participants?.[0]?.count ?? 0,
      interview_participants: undefined,
    }));
  });

export const getInterviewStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: study, error } = await supabase
      .from("interview_studies")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (error || !study) throw new Error(error?.message ?? "Study not found");
    const { data: participants, error: pErr } = await supabase
      .from("interview_participants")
      .select("*")
      .eq("study_id", data.id)
      .order("ordinal", { ascending: true });
    if (pErr) throw new Error(pErr.message);
    return { study, participants: participants ?? [] };
  });

export const deleteInterviewStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { error } = await supabase
      .from("interview_studies")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
