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
export function buildEnhancePrompt(
  data: z.infer<typeof FormattingEnhanceInput>,
): { prompt: string; promptCached: string; promptDynamic: string } {
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

  // Cached prefix: brief + the document body — these stay identical across re-runs on the same
  // work, so the second pass reads the bulk for free instead of re-billing it.
  const promptCached = `You are an expert editor improving a piece of academic/professional writing before submission. You may rewrite, restructure, trim, or expand as needed — but you must preserve the author's voice, argument, and factual content. Never invent facts, sources, or data that weren't already in the work.
${data.briefText?.trim() ? `\nBRIEF / REQUIREMENTS:\n"""\n${data.briefText.slice(0, 50000)}\n"""\n` : ""}
WORK TO EDIT:
"""
${data.documentText.slice(0, 100000)}
"""`;

  const promptDynamic = `

WORD COUNT INSTRUCTION: ${wordInstruction}

WEAKNESSES TO ADDRESS:
${weaknessLines}

MISSING REQUIREMENTS TO ADDRESS (add real content for these, don't just gesture at them):
${missingLines}

Output ONLY the full revised document text, start to finish — no preamble, no commentary, no markdown code fences, no notes about what you changed.`;

  return { prompt: promptCached + promptDynamic, promptCached, promptDynamic };
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
export function buildFormattingPrompt(
  data: z.infer<typeof FormattingRunInput>,
): { prompt: string; promptCached: string; promptDynamic: string } {
  const fieldLines = Object.entries(data.fields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join("\n") || "- (none provided)";

  const requirementsLines = data.requirements.length
    ? data.requirements.map((r) => `- ${r}`).join("\n")
    : "- (none explicitly stated — use sound default academic formatting)";

  const promptCached = `You are a meticulous proofreader and publisher. Your only job is to turn the WORK below into a submission-ready document — you are not the writer/editor here, you do not change the substance of the writing, only its presentation, structure, completeness, and citation correctness.

DOCUMENT TYPE: ${data.documentType}
STYLE GUIDE: ${data.styleGuide}

FORMATTING REQUIREMENTS FROM THE BRIEF:
${requirementsLines}

${data.briefText?.trim() ? `BRIEF / REQUIREMENTS DOCUMENT:\n"""\n${data.briefText.slice(0, 50000)}\n"""\n` : ""}WORK TO FORMAT:
"""
${data.documentText.slice(0, 100000)}
"""`;

  const promptDynamic = `

SUBMISSION DETAILS PROVIDED BY THE USER (use these verbatim on the cover page — never invent or alter them):
${fieldLines}
${data.instructions?.trim() ? `\nADDITIONAL USER INSTRUCTIONS:\n${data.instructions.trim()}\n` : ""}
Do the following, in order:

1. Emit a single line, before anything else: \`@@COVERPAGE@@\` followed by a compact JSON object with exactly this shape: {"title": string, "documentType": string, "fields": [{"label": string, "value": string}, ...]}. The "fields" array must contain the submission details above (label them naturally, e.g. "Student Number" not "student_number"), in cover-page order: full name first, then student/ID numbers, then course/module code, module title, institution, instructor/supervisor name, and date last. Infer the title from the document if it has no explicit title — never use a generic placeholder.

2. Then write out the FULL body of the work, reformatted to strict ${data.styleGuide} conventions. Apply every rule below without exception:

   HEADINGS & STRUCTURE
   - Use markdown heading levels (#, ##, ###, ####) consistently and hierarchically. Level 1 (#) for major sections (Introduction, Literature Review, Methodology, Results, Discussion, Conclusion, References). Level 2 (##) for subsections. Level 3 (###) for sub-subsections. Level 4 (####) sparingly.
   - Every heading must be a real section break, not a decorative label — the table of contents is built from them.
   - For APA: Level 1 headings should be on their own line, bold, centered. Level 2: left-aligned, bold. Level 3: left-aligned, bold italic. Level 4: indented, bold.

   PARAGRAPHS
   - Body paragraphs are indented (first line 0.5 inch) with no blank line between them — this is enforced by the exporter; just write clean paragraphs separated by a blank line.
   - Block quotations (40+ words): indent the entire quotation 0.5 inch from the left margin with no additional first-line indent. Use a separate paragraph.

   ABSTRACT (if applicable)
   - If the document type requires an abstract (e.g. research paper, dissertation, thesis), include a section headed exactly "Abstract" (level 1 heading). The abstract body is a single un-indented paragraph. An "Keywords:" line follows on the next line.

   TABLES
   - Reproduce every table from the original as a markdown table (| col | col | with | --- | separator row).
   - Number tables consecutively: each table must be preceded by its label on its own line, e.g. "Table 1" (no punctuation, no italic). If the table has a descriptive title, put it on the line after the label, in italic.
   - After the table, add a "Note." line (if any general note applies) indented and in normal weight.
   - APA/Chicago: no vertical borders — horizontal lines only (top, below header, bottom); the exporter applies this automatically.

   FIGURES & IMAGES
   - If the original contains image placeholders (@@FIGURE@@ markers) or describes figures, retain the placeholder exactly — do not remove or reorder @@FIGURE@@ lines.
   - Precede each @@FIGURE@@ line with "Figure N" on its own line (where N is the running count).
   - The caption (italicised in the output) should be embedded in the @@FIGURE@@ JSON as "caption": "...".

   LISTS
   - Use markdown bullet lists (- item) for unordered lists and numbered lists (1. item) for ordered/sequential content.
   - Hanging indent on list items is enforced by the exporter.

   CITATIONS & REFERENCES
   - Reformat every in-text citation to strict, correct ${data.styleGuide} style.
   - The final section must be headed exactly "References" (APA/Harvard/IEEE), "Works Cited" (MLA), or "Bibliography" (Chicago) — use the correct term for the style.
   - The reference list must be double-spaced with a 0.5-inch hanging indent (first line flush, continuation lines indented) — the exporter enforces this for any section headed "References", "Works Cited", or "Bibliography".
   - Sort/order per ${data.styleGuide} rules (APA/MLA/Harvard = alphabetical by author surname; Chicago = alphabetical; IEEE = order of citation).
   - Never invent a source. Never alter author names, dates, or titles. Fix only formatting/punctuation.
   - If a cited source is missing from the reference list (or vice versa), flag it inline with [CITATION MISSING] or [REFERENCE MISSING] rather than inventing or silently dropping it.

   MISSING REQUIRED SECTIONS
   - If the brief explicitly requires a section that is entirely absent (e.g. an abstract, a declaration of originality, an appendix), add a clearly headed placeholder paragraph stating what is missing and what the brief requires — never fabricate the missing content.

   WHAT NOT TO CHANGE
   - Preserve every substantive sentence, argument, data point, and example exactly. You are the publisher, not the editor or writer.
   - Do not include a title page, your own table of contents, or a second reference list — those are handled separately by the exporter.

Output nothing except the @@COVERPAGE@@ line on line 1, followed immediately by the reformatted body. No preamble, no commentary, no sign-off, no markdown code fences.`;

  return { prompt: promptCached + promptDynamic, promptCached, promptDynamic };
}
