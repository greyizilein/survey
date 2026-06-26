import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const STYLE_GUIDES = ["APA", "MLA", "Chicago", "Harvard", "IEEE", "Unspecified"] as const;
export type StyleGuide = (typeof STYLE_GUIDES)[number];

const RequirementsInput = z.object({
  documentText: z.string().max(120000),
  briefText: z.string().max(60000).optional(),
});

const FieldSpec = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().optional(),
});

/**
 * Cheap-model pass: reads the work + the brief/requirements and figures out what a
 * submission-ready version needs — citation style, document type, anything already
 * findable in the document (so the user isn't re-typing their own name), and anything
 * genuinely missing that only the user can supply.
 */
export const extractFormattingRequirements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RequirementsInput.parse(d))
  .handler(async ({ data }) => {
    const { createAi, CHEAP_EXTRACTION_MODEL } = await import("./ai-gateway.server");
    const { generateObject } = await import("ai");
    const ai = createAi();

    const prompt = `You are a submissions clerk preparing to format a document for final submission. Read the work and (if provided) the brief/requirements, and report what's needed to make this submission-ready.

WORK (the document being submitted):
"""
${data.documentText.slice(0, 100000)}
"""

${data.briefText?.trim() ? `BRIEF / REQUIREMENTS (assignment instructions, rubric, submission guidelines):\n"""\n${data.briefText.slice(0, 50000)}\n"""` : "No brief/requirements document was provided — infer reasonable defaults for an academic submission."}

Determine:
1. The citation/style guide required (APA, MLA, Chicago, Harvard, IEEE) — read the brief for an explicit statement, or infer from the document's existing reference style. Use "Unspecified" only if truly impossible to tell.
2. The document type (e.g. "Research proposal", "Lab report", "Essay", "Dissertation chapter", "Case study").
3. detectedFields — cover-page/identity fields you can ALREADY find stated somewhere in the work or brief (e.g. student name, student/ID number, course/module code, module title, instructor/supervisor name, institution, submission date, word count limit). Only include a field here if you found an actual value for it — never guess a value.
4. missingFields — fields a submission-ready cover page or header for this document type would need, that you could NOT find a value for anywhere. Common ones: student name, student number, course/module, instructor name, institution, submission date. Only list fields that are actually plausible for this kind of document — don't pad the list.
5. requirements — a short bullet list of concrete formatting requirements you found in the brief (font, spacing, margins, page/word limits, required sections, citation density, file format) — only things actually stated, never invented.

Return ONLY the structured data, nothing else.`;

    const { object } = await generateObject({
      model: ai(CHEAP_EXTRACTION_MODEL),
      schema: z.object({
        styleGuide: z.enum(STYLE_GUIDES),
        documentType: z.string(),
        detectedFields: z.array(FieldSpec),
        missingFields: z.array(FieldSpec),
        requirements: z.array(z.string()),
      }),
      prompt,
      temperature: 0,
    });

    return object;
  });

const GradeInput = z.object({
  documentText: z.string().max(120000),
  briefText: z.string().max(60000).optional(),
  documentType: z.string().max(200).optional(),
  currentWordCount: z.number().int().nonnegative(),
});

const GradeCriterion = z.object({
  name: z.string(),
  score: z.number(),
  max: z.number(),
  comment: z.string(),
});

/**
 * Grader role. Always runs on the strongest model (same direct-Anthropic connection as
 * the publisher pass) — grading needs real judgment, not mechanical extraction.
 */
export const gradeWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GradeInput.parse(d))
  .handler(async ({ data }) => {
    const { createCodeExecutionAi, CODE_EXECUTION_MODEL } = await import("./ai-gateway.server");
    const { generateObject } = await import("ai");
    const ai = createCodeExecutionAi();

    const prompt = `You are a strict, fair academic grader. Read the WORK below and weigh it against the BRIEF (assignment instructions / rubric), then grade it honestly — this score is a prediction to help the author improve before they submit, so be accurate, not generous.

${data.documentType ? `DOCUMENT TYPE: ${data.documentType}\n` : ""}
BRIEF / REQUIREMENTS:
"""
${data.briefText?.trim() || "No brief was provided — grade against general academic quality standards for this kind of document: clarity, structure, evidence, argument quality, and correctness."}
"""

WORK:
"""
${data.documentText.slice(0, 100000)}
"""

The work's current word count (computed exactly, trust this number, do not recount): ${data.currentWordCount} words.

Determine:
1. targetWordCountMin / targetWordCountMax — if the brief states a word count or page limit, convert/state it as a word range (null/null if not stated; if only a single number or "approximately N" is stated, use a sensible +/-10% range).
2. A score out of 100 (or your own maxScore if the brief states a different total — then scale "score" to that same max), plus a breakdown into 3-6 named criteria (e.g. "Argument & analysis", "Evidence & citation", "Structure & clarity", "Adherence to brief") each with its own score/max and a one-sentence comment.
3. strengths — 2-4 concrete things the work does well.
4. weaknesses — 2-5 concrete, fixable issues (only real ones — do not pad).
5. missingRequirements — anything the brief explicitly asks for that this work doesn't deliver (empty array if none).
6. verdict — one or two sentences: is this submission-ready as-is, or would it benefit from edits before submission?

Return ONLY the structured data.`;

    const { object } = await generateObject({
      model: ai(CODE_EXECUTION_MODEL),
      schema: z.object({
        score: z.number(),
        maxScore: z.number(),
        criteria: z.array(GradeCriterion),
        targetWordCountMin: z.number().nullable(),
        targetWordCountMax: z.number().nullable(),
        strengths: z.array(z.string()),
        weaknesses: z.array(z.string()),
        missingRequirements: z.array(z.string()),
        verdict: z.string(),
      }),
      prompt,
      temperature: 0.2,
    });

    return object;
  });

export const FormattingEnhanceInput = z.object({
  documentText: z.string().max(120000),
  briefText: z.string().max(60000).optional(),
  currentWordCount: z.number().int().nonnegative(),
  targetWordCountMin: z.number().int().nonnegative().nullable().optional(),
  targetWordCountMax: z.number().int().nonnegative().nullable().optional(),
  weaknesses: z.array(z.string()).max(20).default([]),
  missingRequirements: z.array(z.string()).max(20).default([]),
});

/**
 * Editor role. Builds the trim/expand-and-improve prompt for the strong model — the
 * model never trusts itself to count words; the caller passes in a JS-computed count.
 */
export function buildEnhancePrompt(data: z.infer<typeof FormattingEnhanceInput>): { prompt: string } {
  const hasTarget = data.targetWordCountMin != null && data.targetWordCountMax != null;
  let wordInstruction = "No explicit word count target was found — focus purely on quality, not length.";
  if (hasTarget) {
    const min = data.targetWordCountMin as number;
    const max = data.targetWordCountMax as number;
    if (data.currentWordCount > max) {
      wordInstruction = `The work is currently ${data.currentWordCount} words but must land between ${min} and ${max} words. TRIM it down: tighten prose, cut redundancy and filler, merge repetitive points — never cut substantive content, evidence, or required sections just to hit the number. Every sentence you keep should pull its weight.`;
    } else if (data.currentWordCount < min) {
      wordInstruction = `The work is currently ${data.currentWordCount} words but must land between ${min} and ${max} words. EXPAND it: deepen analysis, add supporting evidence/examples, develop underdeveloped points — never pad with filler, repetition, or fluff. Every sentence you add should earn its place.`;
    } else {
      wordInstruction = `The work is currently ${data.currentWordCount} words, already within the required ${min}-${max} word range — keep the length roughly where it is while making the quality improvements below.`;
    }
  }

  const weaknessLines = data.weaknesses.length ? data.weaknesses.map((w) => `- ${w}`).join("\n") : "- (none flagged)";
  const missingLines = data.missingRequirements.length ? data.missingRequirements.map((m) => `- ${m}`).join("\n") : "- (none flagged)";

  const prompt = `You are an expert editor improving a piece of academic/professional writing before submission. You may rewrite, restructure, trim, or expand as needed — but you must preserve the author's voice, argument, and factual content. Never invent facts, sources, or data that weren't already in the work.

WORD COUNT INSTRUCTION: ${wordInstruction}

WEAKNESSES TO ADDRESS:
${weaknessLines}

MISSING REQUIREMENTS TO ADDRESS (add real content for these, don't just gesture at them):
${missingLines}
${data.briefText?.trim() ? `\nBRIEF / REQUIREMENTS:\n"""\n${data.briefText.slice(0, 50000)}\n"""\n` : ""}
WORK TO EDIT:
"""
${data.documentText.slice(0, 100000)}
"""

Output ONLY the full revised document text, start to finish — no preamble, no commentary, no markdown code fences, no notes about what you changed.`;

  return { prompt };
}

export const FormattingRunInput = z.object({
  documentText: z.string().max(120000),
  briefText: z.string().max(60000).optional(),
  styleGuide: z.enum(STYLE_GUIDES),
  documentType: z.string().max(200),
  fields: z.record(z.string(), z.string()).default({}),
  requirements: z.array(z.string()).max(40).default([]),
  instructions: z.string().max(2000).optional(),
});

/**
 * Builds the prompt for the actual formatting/publishing pass. This intentionally always
 * runs on the strongest available model via the direct Anthropic connection (see
 * CODE_EXECUTION_MODEL in ai-gateway.server.ts) regardless of the user's Fast/Pro/Max
 * tier — formatting/citation precision needs the best instruction-following available,
 * not whichever cheap/quality model the user happens to have picked for chat.
 */
export function buildFormattingPrompt(data: z.infer<typeof FormattingRunInput>): { prompt: string } {
  const fieldLines = Object.entries(data.fields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join("\n") || "- (none provided)";

  const requirementsLines = data.requirements.length
    ? data.requirements.map((r) => `- ${r}`).join("\n")
    : "- (none explicitly stated — use sound default academic formatting)";

  const prompt = `You are a meticulous proofreader and publisher. Your only job is to turn the WORK below into a submission-ready document — you are not the writer/editor here, you do not change the substance of the writing, only its presentation, structure, completeness, and citation correctness.

DOCUMENT TYPE: ${data.documentType}
STYLE GUIDE: ${data.styleGuide}

SUBMISSION DETAILS PROVIDED BY THE USER (use these verbatim on the cover page — never invent or alter them):
${fieldLines}

FORMATTING REQUIREMENTS FROM THE BRIEF:
${requirementsLines}
${data.instructions?.trim() ? `\nADDITIONAL USER INSTRUCTIONS:\n${data.instructions.trim()}` : ""}

${data.briefText?.trim() ? `BRIEF / REQUIREMENTS DOCUMENT:\n"""\n${data.briefText.slice(0, 50000)}\n"""\n` : ""}
WORK TO FORMAT:
"""
${data.documentText.slice(0, 100000)}
"""

Do the following, in order:

1. Emit a single line, before anything else: \`@@COVERPAGE@@\` followed by a compact JSON object with exactly this shape: {"title": string, "documentType": string, "fields": [{"label": string, "value": string}, ...]}. The "fields" array should be the submission details above (label them naturally, e.g. "Student Number" not "student_number"), in a sensible cover-page order (name first, then identifiers, then course/institution, then date last). Pick a clear title for the work itself (infer it from the document if it has no explicit title).

2. Then write out the FULL body of the work, reformatted to ${data.styleGuide} conventions:
   - Preserve every substantive sentence and argument exactly — you are not rewriting, condensing, or expanding the writing itself.
   - Fix heading structure so it's consistent and hierarchical (use markdown #, ##, ### for section levels) — this drives the table of contents, so headings must be real section breaks, not decorative text.
   - Reformat in-text citations and the reference/bibliography list to strict, correct ${data.styleGuide} style. Fix inconsistent or malformed citations. Alphabetize/order the reference list per ${data.styleGuide} rules. Never invent a source that wasn't already cited somewhere in the work.
   - If the brief requires sections that are entirely absent from the work (e.g. an abstract, a declaration, an appendix), add a clearly headed placeholder section noting what's missing and what the brief requires there — never fabricate the missing content itself.
   - Tables in the original work should be reproduced as markdown tables (| col | col |).
   - Do not include a title page, your own table of contents, or a restated reference list outside the body's final References/Bibliography section — those are handled separately.

Output nothing except the @@COVERPAGE@@ line followed by the reformatted body. No preamble, no commentary, no sign-off.`;

  return { prompt };
}
