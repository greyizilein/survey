import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const QuickFillInput = z.object({
  survey_url: z.string().url(),
  respondent_count: z.number().int().min(1).max(25).default(5),
  audience_brief: z.string().max(500).optional(),
  response_length: z.enum(["short", "medium", "long"]).default("medium"),
  variation: z.number().min(0).max(100).default(50),
  personality: z.string().max(300).optional(),
  population_id: z.string().uuid().optional(),
  sampling_method: z.enum(["random", "stratified"]).default("random"),
});

interface Question {
  id: string;
  text: string;
  type: "multiple_choice" | "single_choice" | "open_ended" | "likert" | "matrix" | "yes_no" | "rating";
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
  life_situation: string | null;
  key_concerns: string[] | null;
  voice_sample: string | null;
  tags: string[] | null;
}

export const createFillRunFromLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => QuickFillInput.parse(d))
  .handler(async ({ data, context }) => {
    const url = new URL(data.survey_url);
    const title = `Fill run · ${url.hostname.replace(/^www\./, "")}`;

    // Google Forms expose their exact structure (questions + entry IDs), which
    // lets us submit responses directly — no browser or extension needed.
    const { isGoogleFormUrl, fetchGoogleForm } = await import("./google-forms.server");
    let questions: Question[];
    let formAction: string | null = null;
    let formTitle = title;
    let pageHistory = "0";
    if (isGoogleFormUrl(data.survey_url)) {
      const form = await fetchGoogleForm(data.survey_url);
      formAction = form.action;
      formTitle = form.title || title;
      pageHistory = form.pageHistory || "0";
      questions = form.questions.map((q) => ({
        id: q.entryId,
        text: q.title,
        type: mapGoogleType(q.type, q.options),
        options: q.options.length ? q.options : undefined,
        required: q.required,
      }));
      if (!questions.length) throw new Error("No questions found in this form.");
    } else {
      const sourceText = await fetchSurveyText(data.survey_url);
      questions = await parseQuestions(title, sourceText, data.survey_url);
    }

    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        name: title,
        description: `One-click fill run for ${data.survey_url}`,
      })
      .select()
      .single();
    if (projectError || !project) throw new Error(projectError?.message ?? "Could not create fill run");

    const { data: survey, error: surveyError } = await context.supabase
      .from("surveys")
      .insert({
        user_id: context.userId,
        project_id: project.id,
        title,
        source_type: "url",
        source_url: data.survey_url,
        raw_input: formAction ? `Google Form: ${formTitle}` : null,
        parsed_questions: questions as any,
      })
      .select()
      .single();
    if (surveyError || !survey) throw new Error(surveyError?.message ?? "Could not save survey");

    let personas: Persona[];
    if (data.population_id) {
      const { samplePersonas } = await import("./personas.functions");
      personas = await samplePersonas(context.supabase, data.population_id, data.respondent_count, data.sampling_method);
      if (!personas.length) throw new Error("This population has no personas yet.");
    } else {
      personas = await ensurePersonas(context.supabase, context.userId, data.respondent_count, data.audience_brief ?? title);
    }
    const responses = await answerSurvey(questions, personas, data.audience_brief ?? title, {
      responseLength: data.response_length,
      variation: data.variation,
      personality: data.personality,
    });

    const { data: sim, error: simError } = await context.supabase
      .from("simulations")
      .insert({
        user_id: context.userId,
        survey_id: survey.id,
        status: "complete",
        total_personas: responses.length,
        completed_count: responses.length,
      })
      .select()
      .single();
    if (simError || !sim) throw new Error(simError?.message ?? "Could not create simulation");

    const rows = responses.map((response) => ({
      simulation_id: sim.id,
      persona_id: response.persona.id,
      user_id: context.userId,
      answers: response.answers as any,
    }));
    const { error: responseError } = await context.supabase.from("responses").insert(rows);
    if (responseError) throw new Error(responseError.message);

    return {
      project_id: project.id,
      survey_id: survey.id,
      simulation_id: sim.id,
      survey_url: data.survey_url,
      title: formTitle,
      form_action: formAction,
      page_history: pageHistory,
      direct_submit: Boolean(formAction),
      questions,
      responses,
      total_responses: responses.length,
      primary_payload: responses[0]?.answers ?? [],
      extension_payload: responses.map((response) => ({
        persona: response.persona.name,
        answers: response.answers,
      })),
    };
  });

const DirectSubmitInput = z.object({
  form_action: z.string().url(),
  page_history: z.string().default("0"),
  answers: z.array(z.object({
    question_id: z.string(),
    answer: z.string(),
    type: z.string().optional(),
    options: z.array(z.string()).optional(),
  })),
});

// Submit one respondent's answers straight to a Google Form — no browser.
export const submitDirectFill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DirectSubmitInput.parse(d))
  .handler(async ({ data }) => {
    const { submitGoogleForm } = await import("./google-forms.server");
    const entries = data.answers.map((a) => {
      const options = a.options ?? [];
      let values: string[];
      if (a.type === "multiple_choice" && options.length) {
        // Checkbox question — answer may contain several options
        const parts = a.answer.split(/,|;| and |\n/i).map((v) => v.trim()).filter(Boolean);
        values = parts
          .map((p) => options.find((o) => o.toLowerCase() === p.toLowerCase())
            ?? options.find((o) => o.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(o.toLowerCase())))
          .filter((v): v is string => Boolean(v));
        if (!values.length && options.length) values = [options[0]];
      } else if (options.length) {
        // Choice/scale/dropdown — value must be one of the options
        const match = options.find((o) => o.toLowerCase() === a.answer.toLowerCase())
          ?? options.find((o) => o.toLowerCase().includes(a.answer.toLowerCase()) || a.answer.toLowerCase().includes(o.toLowerCase()));
        values = [match ?? options[0]];
      } else {
        values = [a.answer];
      }
      return { entryId: a.question_id, values };
    });
    const ok = await submitGoogleForm(data.form_action, entries, data.page_history);
    if (!ok) throw new Error("Google rejected the submission");
    return { submitted: true };
  });

function mapGoogleType(type: number, options: string[]): Question["type"] {
  switch (type) {
    case 0: return "open_ended";
    case 1: return "open_ended";
    case 2: return "single_choice";
    case 3: return "single_choice";
    case 4: return "multiple_choice";
    case 5: return "likert";
    case 7: return options.length ? "likert" : "matrix";
    default: return "open_ended";
  }
}

async function fetchSurveyText(url: string) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Surveyor" } });
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return `${title}\n${body}`.slice(0, 30000);
  } catch {
    return `Survey URL: ${url}. The form could not be fetched directly, so infer a practical short survey from the URL/topic.`;
  }
}

async function parseQuestions(title: string, sourceText: string, url: string): Promise<Question[]> {
  try {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();
    const prompt = `Extract the survey questions from this page. If the page text is sparse or blocked, infer 6-10 likely questions from the title and URL.

Title: ${title}
URL: ${url}
Page text:
"""
${sourceText}
"""

Return ONLY valid JSON, an array of questions:
[{"id":"q1","text":"Question text","type":"multiple_choice|single_choice|open_ended|likert|matrix|yes_no|rating","options":["only if visible or likely"],"required":true}]`;
    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return fallbackQuestions(title, url);
    return normalizeQuestions(JSON.parse(match[0]), title, url);
  } catch {
    return fallbackQuestions(title, url);
  }
}

async function ensurePersonas(supabase: any, userId: string, count: number, brief: string): Promise<Persona[]> {
  const { data: existing } = await supabase.from("personas").select("*").order("created_at", { ascending: false }).limit(count);
  if ((existing ?? []).length >= count) return existing.slice(0, count);

  const missing = count - (existing?.length ?? 0);
  const generated = makePersonas(missing, brief, existing?.length ?? 0).map((p) => ({ user_id: userId, ...p }));
  const { data: inserted, error } = await supabase.from("personas").insert(generated).select("*");
  if (error) throw new Error(error.message);
  return [...(existing ?? []), ...(inserted ?? [])].slice(0, count);
}

interface AnswerStyle {
  responseLength: "short" | "medium" | "long";
  variation: number;
  personality?: string;
}

async function answerSurvey(questions: Question[], personas: Persona[], brief: string, style?: AnswerStyle) {
  try {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();
    const questionList = questions.map((q, idx) => `${idx + 1}. id="${q.id}" [${q.type}] ${q.text}${q.options?.length ? `\n   Options: ${q.options.map((o) => `"${o}"`).join(" | ")}` : ""}${q.required === false ? " (optional)" : ""}`).join("\n");

    const lengthGuide = {
      short: "Open-text answers: a phrase or one short sentence. Stay terse but specific.",
      medium: "Open-text answers: 1-3 natural sentences with a concrete reason or example.",
      long: "Open-text answers: 3-6 sentences with specific lived-experience examples, trade-offs, and reasoning.",
    }[style?.responseLength ?? "medium"];
    const variationGuide = (style?.variation ?? 50) >= 70
      ? "Make wording, sentence length, and tone vary noticeably between respondents — some terse, some chatty, some hedging."
      : (style?.variation ?? 50) <= 30
        ? "Keep answers fairly consistent and to-the-point across respondents."
        : "Vary phrasing naturally between respondents.";
    const personalityGuide = style?.personality?.trim()
      ? `Personality/voice direction for all respondents: ${style.personality.trim()}`
      : "";

    const responses = await Promise.all(personas.map(async (persona) => {
      const prompt = `You are answering a survey IN CHARACTER as a specific real-feeling person. Think before you answer.

WHO YOU ARE
${personaPrompt(persona)}

THE SURVEY
Topic / brief: ${brief}

Questions (answer ALL, in order):
${questionList}

HOW TO REASON (do this silently, do not output it)
1. Re-read each question and what it is really asking.
2. Map it to your lived experience: your job, city, income, education, values, politics, daily constraints.
3. For choice questions, weigh the options against your situation — pick the one that genuinely fits, not the first or middle option.
4. For rating/likert questions, pick the number that matches how someone like you would actually feel — avoid defaulting to "3" or the middle. Distribute realistically.
5. For open-ended questions, give a specific, concrete reason grounded in your life — name a place, habit, cost, person, or trade-off where natural.
6. Stay internally consistent: your answers across questions must reflect the same person (same income, same politics, same priorities).
7. ${lengthGuide}
8. ${variationGuide}
${personalityGuide ? `9. ${personalityGuide}\n` : ""}
OUTPUT FORMAT
Return ONLY a JSON array, one object per question, using the exact "id" given:
[{"question_id":"<id exactly as given>","answer":"<your in-character answer>"}]

Rules:
- Choice/dropdown/yes-no/likert/rating answers MUST match one of the provided option strings verbatim.
- Multi-select (checkbox) answers: join the chosen option strings with ", " — only options that genuinely apply to you.
- Open-ended answers must sound like a real person speaking, not a survey-bot. No corporate fluff.
- Do not invent extra questions or skip required ones.`;
      try {
        const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0.8 });
        const match = text.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : null;
        return { persona, answers: normalizeAnswers(parsed, questions, persona) };
      } catch {
        return { persona, answers: fallbackAnswers(questions, persona) };
      }
    }));
    return responses;
  } catch {
    return personas.map((persona) => ({ persona, answers: fallbackAnswers(questions, persona) }));
  }
}


function normalizeQuestions(value: unknown, title: string, url: string): Question[] {
  if (!Array.isArray(value)) return fallbackQuestions(title, url);
  const questions = value.slice(0, 20).map((item: any, index) => ({
    id: String(item?.id ?? `q${index + 1}`),
    text: String(item?.text ?? item?.question ?? "").trim(),
    type: ["multiple_choice", "single_choice", "open_ended", "likert", "matrix", "yes_no", "rating"].includes(item?.type) ? item.type : "open_ended",
    options: Array.isArray(item?.options) ? item.options.map(String).filter(Boolean).slice(0, 12) : undefined,
    required: item?.required !== false,
  })).filter((q) => q.text.length > 2);
  return questions.length ? questions : fallbackQuestions(title, url);
}

function fallbackQuestions(title: string, url: string): Question[] {
  const topic = title.replace(/^Fill run ·\s*/, "") || new URL(url).hostname;
  return [
    { id: "q1", text: `How familiar are you with ${topic}?`, type: "single_choice", options: ["Not familiar", "Slightly familiar", "Moderately familiar", "Very familiar"], required: true },
    { id: "q2", text: `What is your overall opinion of ${topic}?`, type: "likert", options: ["1", "2", "3", "4", "5"], required: true },
    { id: "q3", text: `What would make you more likely to engage with ${topic}?`, type: "open_ended", required: true },
    { id: "q4", text: "How likely are you to recommend this to someone else?", type: "rating", options: ["1", "2", "3", "4", "5"], required: true },
    { id: "q5", text: "Which factor matters most to you?", type: "single_choice", options: ["Price", "Quality", "Convenience", "Trust", "Support"], required: true },
    { id: "q6", text: "Is there anything else you want to add?", type: "open_ended", required: false },
  ];
}

function normalizeAnswers(answers: unknown, questions: Question[], persona: Persona) {
  if (!Array.isArray(answers)) return fallbackAnswers(questions, persona);
  const byId = new Map(answers.map((item: any) => [String(item?.question_id ?? ""), item?.answer]));
  return questions.map((question) => ({
    question_id: question.id,
    question: question.text,
    type: question.type,
    options: question.options ?? [],
    answer: byId.has(question.id) ? String(byId.get(question.id) ?? "") : fallbackAnswer(question, persona),
  }));
}

function fallbackAnswers(questions: Question[], persona: Persona) {
  return questions.map((question) => ({
    question_id: question.id,
    question: question.text,
    type: question.type,
    options: question.options ?? [],
    answer: fallbackAnswer(question, persona),
  }));
}

function fallbackAnswer(question: Question, persona: Persona) {
  if (question.options?.length) return question.options[Math.abs(hash(`${persona.id}-${question.id}`)) % question.options.length];
  if (question.type === "rating" || question.type === "likert") return String(3 + (Math.abs(hash(`${persona.name}-${question.text}`)) % 3) - 1);
  if (question.type === "yes_no") return Math.abs(hash(`${question.id}-${persona.country}`)) % 2 === 0 ? "Yes" : "No";
  const place = [persona.city, persona.country].filter(Boolean).join(", ") || "my area";
  return `As ${persona.occupation ?? "someone with my background"} in ${place}, I would say it depends on trust, cost, and whether it fits into my normal routine.`;
}

function personaPrompt(p: Persona) {
  const location = [p.city, p.country].filter(Boolean).join(", ") || "an unspecified location";
  const concerns = p.key_concerns?.length ? p.key_concerns.join(", ") : null;
  const tags = p.tags?.length ? p.tags.join(", ") : null;

  return [
    `You are ${p.name} — ${p.age ?? "?"} years old, ${p.gender ?? "unspecified gender"}, based in ${location}.`,
    p.bio ? `Background: ${p.bio}` : null,
    p.life_situation ? `Your situation right now: ${p.life_situation}` : null,
    concerns ? `What you worry about most: ${concerns}.` : null,
    `Education: ${p.education ?? "unspecified"}. Income: ${p.income_bracket ?? "unspecified"}. Occupation: ${p.occupation ?? "unspecified"}.`,
    `Politics: ${p.political_sentiment ?? "apolitical"}. Core values: ${(p.core_values ?? []).join(", ") || "unspecified"}.`,
    p.voice_sample ? `How you speak (match this register and tone): "${p.voice_sample}"` : `Voice: ${p.language_style ?? "natural"}.`,
    tags ? `Tags: ${tags}.` : null,
    `Answer every question as ${p.name.split(" ")[0]} would — drawing on your specific lived experience, not as a generic ${p.occupation ?? "person"}.`,
  ].filter(Boolean).join("\n");
}

function makePersonas(count: number, brief: string, offset = 0) {
  const countries = ["United States", "United Kingdom", "Canada", "Nigeria", "India", "Brazil", "Germany", "Mexico", "South Africa", "Japan"];
  const cities = ["Columbus", "Manchester", "Toronto", "Lagos", "Bengaluru", "Recife", "Berlin", "Guadalajara", "Cape Town", "Osaka"];
  const jobs = ["teacher", "delivery driver", "nurse", "software analyst", "shop owner", "student", "electrician", "caregiver", "sales manager", "public-sector clerk"];
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    const c = n % countries.length;
    return {
      name: `Respondent ${n + 1}`,
      age: 18 + (n * 7) % 67,
      gender: ["female", "male"][n % 2],
      country: countries[c],
      city: cities[c],
      education: ["high school", "some college", "bachelors", "masters", "trade", "phd"][n % 6],
      income_bracket: ["low", "lower-middle", "middle", "upper-middle", "high"][n % 5],
      occupation: jobs[n % jobs.length],
      political_sentiment: ["progressive", "moderate-left", "centrist", "moderate-right", "conservative", "libertarian", "apolitical"][n % 7],
      core_values: [["family", "security", "fairness"], ["autonomy", "privacy", "quality"], ["community", "stability", "opportunity"]][n % 3],
      language_style: ["warm", "casual", "formal", "blunt", "skeptical", "enthusiastic"][n % 6],
      bio: `I answer surveys from the perspective of a ${jobs[n % jobs.length]} thinking about ${brief.slice(0, 120)}. My responses are practical and shaped by daily constraints.`,
      tags: [countries[c], jobs[n % jobs.length], brief.slice(0, 30)],
    };
  });
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(31, h) + value.charCodeAt(i);
  return h;
}