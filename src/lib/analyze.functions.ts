import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100000),
});

export const AnalyzeChatInput = z.object({
  messages: z.array(ChatMessage).min(1).max(400),
  source: z.union([
    z.object({ type: z.literal("project"), project_id: z.string().uuid() }),
    z.object({
      type: z.literal("file"),
      filename: z.string().max(200),
      rows: z.array(z.record(z.string(), z.unknown())).max(5000),
    }),
    z.object({
      type: z.literal("transcript"),
      filename: z.string().max(200),
      text: z.string().max(400000),
    }),
    z.object({
      type: z.literal("transcripts"),
      files: z
        .array(z.object({ filename: z.string().max(200), text: z.string().max(400000) }))
        .min(1)
        .max(30),
    }),
    z.object({ type: z.literal("none") }),
  ]),
  background: z.string().max(60000).optional(),
  instructionsPreset: z
    .enum([
      "none",
      "chapter4-quant",
      "chapter4-qual",
      "chapter4-mixed",
      "dissertations",
      "writer",
    ])
    .default("none"),
  instructions: z.string().max(4000).optional(),
  folderContext: z.string().max(200000).optional(),
  // Plan-first prompt workflow, layered on top of whichever template is selected:
  // "build" = ask questions + draft a tailored prompt (don't write yet); "execute" = write it;
  // "meta" = Max-tier deep builder that extracts everything it can straight from the uploaded
  // work/brief instead of asking, then drafts the same kind of executable prompt table.
  promptMode: z.enum(["build", "execute", "meta"]).optional(),
});

const DocFile = z.object({ name: z.string().max(200), text: z.string() });
const SummarizeDocsInput = z.object({ files: z.array(DocFile).min(1).max(20) });

export const summarizeAnalysisDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummarizeDocsInput.parse(d))
  .handler(async ({ data }) => {
    const texts = data.files.map((f) => `===== FILE: ${f.name} =====\n${f.text}`);
    let combined = texts.join("\n\n");
    const MAX = 300_000;
    if (combined.length > MAX) combined = combined.slice(0, MAX) + "\n…[truncated]";

    const RAW_PASSTHROUGH_LIMIT = 23_000;
    if (combined.length <= RAW_PASSTHROUGH_LIMIT) {
      return { summary: combined.trim() };
    }

    // Condense per file rather than squeezing the whole joined blob in one shot —
    // a single global squeeze tends to crowd out whichever files land later in the
    // blob. Each file gets its own proportional share of the final 24,000-char budget.
    const { createAi, textModelForTier } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();
    const model = ai(textModelForTier());

    const TOTAL_BUDGET = 22_000;
    const baseBudget = Math.max(1500, Math.floor(TOTAL_BUDGET / data.files.length));
    // Tabular files lose rows (not just prose detail) when squeezed, so give them a
    // bigger share of the total budget at the expense of narrative files, rather than
    // splitting evenly and truncating a csv down to a handful of rows.
    const tabularCount = data.files.filter((f) => isTabular(f.name, f.text)).length;
    const tabularBudget = tabularCount > 0 ? Math.floor((TOTAL_BUDGET * 0.6) / tabularCount) : 0;
    const narrativeBudget =
      tabularCount < data.files.length
        ? Math.max(1500, Math.floor((TOTAL_BUDGET * (tabularCount > 0 ? 0.4 : 1)) / (data.files.length - tabularCount)))
        : baseBudget;

    const summaries = await Promise.all(
      data.files.map(async (f) => {
        const tabular = isTabular(f.name, f.text);
        const perFileBudget = tabular ? Math.max(baseBudget, tabularBudget) : narrativeBudget;
        if (f.text.length <= perFileBudget) {
          return `===== FILE: ${f.name} =====\n${f.text.trim()}`;
        }
        if (tabular) {
          // Tabular data (csv/xlsx) must never go through narrative condensation — an LLM
          // asked to "summarize" a table paraphrases numbers and drops/merges rows, which is
          // exactly what produces "the data was read wrong" complaints. Truncate on row
          // boundaries instead, keeping the header and as many whole rows as fit the budget.
          return `===== FILE: ${f.name} =====\n${truncateRows(f.text, perFileBudget)}`;
        }
        const prompt = `Condense the following written material (a chapter, report, brief, assignment, methodology, or notes) into background context for later use, in no more than ${perFileBudget} characters. Preserve every distinct fact, theme, definition, and finding, and — critically — preserve every distinct piece of work, task, assignment, or component exactly as separate items, including each one's own word counts, deadlines, weightings, and structure. Never merge, drop, or favour one component over another; if the source describes several separate deliverables, your summary must clearly enumerate all of them. This is background context, not data to compute statistics from.

Source content (file "${f.name}"):
"""
${f.text}
"""

Output ONLY the condensed summary as plain text, no markdown headers, no commentary.`;
        const { text } = await generateText({ model, prompt, temperature: 0 });
        return `===== FILE: ${f.name} =====\n${text.trim().slice(0, perFileBudget)}`;
      }),
    );

    return { summary: summaries.join("\n\n").slice(0, 60_000) };
  });

export function isTabular(filename: string, text: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  // Detect by extension regardless of which extractor produced the text — xlsx/xls go
  // through extractText as "Sheet: <name>\n<csv>" blocks, but through the sandbox extractor
  // as a markdown table instead, so content-sniffing alone misses sandboxed spreadsheets.
  if (ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "xls") return true;
  return /^Sheet: /m.test(text);
}


/** Truncates on whole-line boundaries, keeping the header row, so a cut never splits a row
 *  mid-record and misaligns columns for everything that follows. */
export function truncateRows(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  let out = header;
  let i = 1;
  for (; i < lines.length; i++) {
    const next = out.length + 1 + lines[i].length;
    if (next > budget) break;
    out += "\n" + lines[i];
  }
  const omitted = lines.length - i;
  return omitted > 0 ? `${out}\n…[${omitted} more rows omitted for length]` : out;
}

interface ColumnSummary {
  column: string;
  kind: "categorical" | "numeric" | "text";
  counts?: Record<string, number>;
  stats?: { min: number; max: number; avg: number };
  samples?: string[];
}

function summarizeRows(rows: Record<string, unknown>[]): {
  rowCount: number;
  columns: ColumnSummary[];
} {
  if (!rows.length) return { rowCount: 0, columns: [] };
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const columns: ColumnSummary[] = keys.map((key) => {
    const values = rows.map((r) => r[key]).filter((v) => v !== undefined && v !== null && v !== "");
    const numericValues = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    const isNumeric = values.length > 0 && numericValues.length === values.length;
    if (isNumeric) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      return {
        column: key,
        kind: "numeric",
        stats: {
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          avg: numericValues.length ? sum / numericValues.length : 0,
        },
      };
    }
    const strValues = values.map((v) => String(v));
    const distinct = new Set(strValues);
    if (distinct.size > 0 && distinct.size <= 20) {
      const counts: Record<string, number> = {};
      for (const v of strValues) counts[v] = (counts[v] ?? 0) + 1;
      return { column: key, kind: "categorical", counts };
    }
    return { column: key, kind: "text", samples: strValues.slice(0, 25) };
  });
  return { rowCount: rows.length, columns };
}

interface Question {
  id: string;
  text: string;
  type: string;
  options?: string[];
}

export async function buildProjectDataset(supabase: any, projectId: string) {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Project not found");

  const { data: surveys } = await supabase.from("surveys").select("*").eq("project_id", projectId);
  const surveyIds = (surveys ?? []).map((s: any) => s.id);
  const { data: simulations } = surveyIds.length
    ? await supabase.from("simulations").select("*").in("survey_id", surveyIds)
    : { data: [] };
  const simIds = (simulations ?? []).map((s: any) => s.id);
  const { data: responses } = simIds.length
    ? await supabase.from("responses").select("*, personas(*)").in("simulation_id", simIds)
    : { data: [] };

  const surveySummaries = (surveys ?? []).map((survey: any) => {
    const questions: Question[] = (survey.parsed_questions ?? []) as Question[];
    const surveySimIds = new Set(
      (simulations ?? []).filter((s: any) => s.survey_id === survey.id).map((s: any) => s.id),
    );
    const surveyResponses = (responses ?? []).filter((r: any) => surveySimIds.has(r.simulation_id));

    const questionSummaries = questions.map((q) => {
      const answers = surveyResponses
        .map(
          (r: any) => (r.answers as any[] | null)?.find((a: any) => a.question_id === q.id)?.answer,
        )
        .filter((a: unknown) => a !== undefined && a !== null && a !== "");
      const distinct = new Set(answers.map(String));
      if (q.options?.length || (distinct.size > 0 && distinct.size <= 15)) {
        const counts: Record<string, number> = {};
        for (const a of answers) counts[String(a)] = (counts[String(a)] ?? 0) + 1;
        return { question: q.text, type: q.type, response_count: answers.length, counts };
      }
      return {
        question: q.text,
        type: q.type,
        response_count: answers.length,
        sample_answers: answers.slice(0, 15).map(String),
      };
    });

    return {
      survey_title: survey.title,
      background_context: survey.background_context ?? undefined,
      respondent_count: surveyResponses.length,
      questions: questionSummaries,
    };
  });

  return { project_name: project.name, surveys: surveySummaries };
}

export const listAnalyzeProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const ChartSpec = z.object({
  type: z.enum(["bar", "line", "pie"]),
  title: z.string(),
  data: z.array(z.object({ name: z.string(), value: z.number() })),
});

export const TableSpec = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
});

/** Every branch below places the literal "CONVERSATION SO FAR" header right before the
 *  per-turn conversation history — everything ahead of it (templates, background docs,
 *  the dataset's RAW ROWS, instructions) is identical on every turn of the same chat. Splitting
 *  there lets the caller mark that prefix as an Anthropic prompt-cache breakpoint, so a
 *  multi-turn conversation over the same large dataset/background only pays full input price
 *  on the first turn instead of re-billing it every turn. */
function splitForCache(prompt: string): { promptCached: string; promptDynamic: string } {
  const marker = "CONVERSATION SO FAR";
  const idx = prompt.indexOf(marker);
  if (idx === -1) return { promptCached: "", promptDynamic: prompt };
  return { promptCached: prompt.slice(0, idx), promptDynamic: prompt.slice(idx) };
}

export async function buildAnalyzePrompt(
  data: z.infer<typeof AnalyzeChatInput>,
  supabase: any,
): Promise<{
  model: string;
  prompt: string;
  promptCached: string;
  promptDynamic: string;
  useCodeExecution: boolean;
  useWebSearch: boolean;
}> {
  let datasetBlock =
    "No dataset has been provided yet. If the user asks for analysis, ask them to pick a project or upload a file first.";
  let hasRealDataset = false;
  if (data.source.type === "project") {
    const dataset = await buildProjectDataset(supabase, data.source.project_id);
    datasetBlock = `Dataset (survey responses from project "${dataset.project_name}"):\n${JSON.stringify(dataset, null, 2)}`;
    hasRealDataset = dataset.surveys.some(
      (s: { respondent_count: number }) => s.respondent_count > 0,
    );
  } else if (data.source.type === "file") {
    const summary = summarizeRows(data.source.rows);
    datasetBlock = `Dataset (uploaded file "${data.source.filename}", ${summary.rowCount} rows):\n${JSON.stringify(summary, null, 2)}\n\nRAW ROWS (for code execution — use this, not the precomputed summary above, when you compute statistics):\n${JSON.stringify(data.source.rows)}`;
    hasRealDataset = summary.rowCount > 0;
  } else if (data.source.type === "transcript") {
    const transcriptText = data.source.text.trim();
    datasetBlock = `QUALITATIVE DATASET — full transcript "${data.source.filename}" (this is the complete, real transcript, not a preview or sample; treat every line as authoritative source material for coding/theming and never invent or paraphrase what wasn't actually said):\n${transcriptText}`;
    hasRealDataset = transcriptText.length > 0;
  } else if (data.source.type === "transcripts") {
    const files = data.source.files.filter((f) => f.text.trim().length > 0);
    hasRealDataset = files.length > 0;
    if (files.length === 1) {
      datasetBlock = `QUALITATIVE DATASET — full transcript "${files[0].filename}" (this is the complete, real transcript, not a preview or sample; treat every line as authoritative source material for coding/theming and never invent or paraphrase what wasn't actually said):\n${files[0].text.trim()}`;
    } else if (files.length > 1) {
      // Many interview transcripts together can be huge — give each one a proportional
      // share of a total character budget rather than sending every file in full and
      // blowing up prompt size, truncating on line boundaries so a cut never lands mid-word.
      const TOTAL_BUDGET = 350_000;
      const perFileBudget = Math.max(3000, Math.floor(TOTAL_BUDGET / files.length));
      const blocks = files.map((f) => {
        const text = f.text.trim();
        if (text.length <= perFileBudget) return { filename: f.filename, text, truncated: false };
        const lines = text.split("\n");
        let out = "";
        for (const line of lines) {
          if (out.length + 1 + line.length > perFileBudget) break;
          out += (out ? "\n" : "") + line;
        }
        return { filename: f.filename, text: out, truncated: true };
      });
      datasetBlock = `QUALITATIVE DATASET — ${files.length} full interview transcripts (each is complete, real source material; treat every line as authoritative for coding/theming and never invent or paraphrase what wasn't actually said). Always cite which interview a quote/theme came from by its filename.\n\n${blocks
        .map(
          (b) =>
            `===== TRANSCRIPT: ${b.filename} =====\n${b.text}${b.truncated ? "\n…[truncated for length — this transcript was longer than fit the per-file budget]" : ""}`,
        )
        .join("\n\n")}`;
    }
  }
  const isQualitativeTranscript = data.source.type === "transcript" || data.source.type === "transcripts";

  // Long-running chats (e.g. writing a whole dissertation chapter by chapter) can build up
  // hundreds of turns. Sending all of them every time would blow up prompt size and cost, so
  // once a conversation gets long we keep only the most recent turns in full and note that
  // earlier history was dropped, instead of silently truncating mid-conversation or rejecting
  // the request outright.
  const RECENT_TURNS = 40;
  const trimmedCount = Math.max(0, data.messages.length - RECENT_TURNS);
  const recentMessages = trimmedCount > 0 ? data.messages.slice(-RECENT_TURNS) : data.messages;
  const history =
    (trimmedCount > 0
      ? `[${trimmedCount} earlier message(s) from this conversation have been omitted to save space — continue naturally from the recent messages below.]\n\n`
      : "") +
    recentMessages
      .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
      .join("\n\n");

  const backgroundBlock = data.background?.trim()
    ? `\n\nBACKGROUND CONTEXT (from uploaded chapters/reports — use this to understand the subject matter, never as a source of statistics):\n${data.background.trim()}`
    : "";

  const multiWorkBlock = data.background?.trim()
    ? `\n\nMULTI-WORK CHECK: Look at the background context above. If it contains more than one distinct piece of work, brief, assignment, or task (for example several separate questions, case studies, chapters, projects, or briefs bundled into the same upload), do not start producing output yet. Instead, briefly list the distinct pieces of work you can identify, ask the user which one (or which ones, and in what order) they want you to focus on, and ask any other clarifying questions you genuinely need about scope, requirements, or priorities — the way a thoughtful human collaborator would. Keep the conversation going naturally across turns, answering the user's questions and asking your own, until both of you are clearly aligned and the user confirms they are ready to begin. Only once that confirmation is given should you proceed to produce the actual requested output. If the background context clearly contains only one piece of work, skip this check and proceed normally.`
    : "";

  // Templates are server-side reference knowledge only — they are never sent to the model.
  // Instead, each preset maps to a comprehensive inline spec that captures all structural,
  // stylistic, and procedural guidance without being verbatim template text.
  const PRESET_SPECS: Record<string, string> = {
    "chapter4-quant": `CHAPTER FOUR — QUANTITATIVE DATA ANALYSIS AND FINDINGS

WORD COUNT: The user sets the total chapter word count. Ask the user for it if not already stated. Distribute proportionally across sections as follows (adjust all section allocations proportionally to the total requested):
- Introduction: ~4% of total
- Data Preparation, Cleaning, and Screening: ~9%
- Demographic/Contextual Profile of Respondents: ~9%
- Descriptive Analysis (per research question, equal split): ~37% total
- Inferential Analysis (per research question, equal split): ~37% total
- Reliability and Assumption Checks: included within inferential sections
- Discussion of Findings: ~600–650 words (fixed regardless of total)
- Chapter Summary: ~100 words (fixed)
Do not impose any word count not derived from the user's stated total.

PACING: Write section by section. After each section stop immediately and wait for explicit instruction. Do not preview later sections.

CORE PRINCIPLE: This chapter must prove the evidence was analysed properly. It must not read like exported software output with commentary — it must read like an argument built from data. Every table must be introduced before it appears. Every figure must have a clear purpose. Every result must be interpreted conceptually and linked to a research question.

HUMAN WRITING STANDARD: Academic formality, UK English, no first-person, no contractions. Vary sentence length sharply. Avoid stock AI phrases, repetitive transitions, and mechanical rhythm.

ANALYTICAL STANDARD: Reporting a mean is not analysis. Reporting a p-value is not analysis. Every result must be explained in terms of direction, magnitude, certainty, model contribution, practical relevance, and caution. Distinguish statistical significance from substantive importance. Distinguish descriptive patterns from inferential conclusions.

CHAPTER STRUCTURE (execute in this order):

1. INTRODUCTION
Establish scope, purpose, and logic. State the final valid sample size, instrument used, key variables, and statistical software. Explain the chapter sequence. Cite relevant methodological framework briefly.

2. DATA PREPARATION, CLEANING, AND SCREENING
Explain how raw data was prepared: completeness screening, duplicate/careless response checks, out-of-range values, missing data handling (state method and justify it — listwise, pairwise, imputation, etc.). Address outliers (z-scores, boxplots, Mahalanobis distance). Where relevant, assess normality, linearity, homoscedasticity, multicollinearity. Include one compact data screening summary table (valid cases, missing cases, treatment method, key diagnostics). Precede with explanatory paragraph, follow with interpretive paragraph. Methodological citations appropriate.

3. DEMOGRAPHIC/CONTEXTUAL PROFILE OF RESPONDENTS
Each demographic examined individually in its own table — never one combined table. For each variable (age, gender, education, role, experience, etc.) present a frequency and percentage table. All percentage columns must total 100%. Use numerals and % symbol throughout. Introduce each table with a paragraph explaining why that variable matters analytically; follow with a paragraph interpreting the pattern — not restating frequencies. Explain what the distribution suggests about composition, representativeness, possible bias, and contextual relevance. No literature citations in this section.

4. DESCRIPTIVE ANALYSIS BY RESEARCH QUESTION
Write one research question at a time, stop after each. Use the topic as subheading, not the question itself. Present full Likert-scale distribution table: frequencies and percentages for SA, A, N, D, SD (written in full before abbreviating), item mean and SD. All item-level percentages must total 100%. Interpret beyond highest/lowest means — examine concentration, dispersion, response skewness, convergence/divergence across items, anomalies (polarised items, unexpectedly neutral items, high variation). Figures only where they clarify structure: grouped bar charts for item mean comparison, stacked Likert charts for response distribution, boxplots for spread. Avoid pie charts. Every figure introduced analytically before and interpreted after.

5. INFERENTIAL ANALYSIS BY RESEARCH QUESTION
Write one research question at a time, stop after each. State variables and hypothesis/analytical expectation. State and justify the inferential test chosen (must match scale, hypothesis structure, and Chapter Three design). Present the statistical model/equation and explain each component — do not insert equations ceremonially. Mandatory table content by test type: regression → model summary, ANOVA, coefficients table; correlation → full matrix with significance and n; group comparison → group statistics and test results; moderation/mediation → path coefficients, interaction term, indirect effect, confidence intervals. One paragraph before each table (what is being tested and why), one paragraph after (critical interpretation of result). Report exact values: coefficients, SEs, t-values, F-statistics, df, R², adjusted R², CIs, exact p-values, effect sizes. Classify and interpret effect sizes. Do not treat p-value alone as sufficient — explain direction, magnitude, certainty, model contribution, and caution. Where null, explain what the null result does and does not mean.

6. RELIABILITY AND ASSUMPTION CHECKS
Explain what reliability means in this study context. Present a reliability table: construct, number of items, Cronbach's alpha, interpretation. State and justify threshold with citation. If any construct falls below threshold, explain implications. Where relevant: composite reliability, item-total correlations, VIF, tolerance, KMO, Bartlett's test, factor loadings, AVE. Only include diagnostics specified in the methodology and actually used. Report relevant assumptions per test (normality, linearity, homoscedasticity, independence, multicollinearity). One compact assumptions table: assumption, test/diagnostic used, threshold/criterion, outcome. Follow with interpretation. Where minor violations occurred, explain whether analysis remained robust. Citations to methodological standards appropriate.

7. DISCUSSION OF FINDINGS
600–650 words. This is discussion of the data — link to literature review and cite to synthesise results across all research questions. Do not merely repeat section-level findings. Ask what the full set of descriptive and inferential results reveals together. Which predictors were strongest? Which relationships were weak, unstable, or non-significant? Did descriptive patterns align with inferential patterns? Were any findings surprising? Were some constructs reliable but weakly predictive? Distinguish statistical strength, consistency of pattern, explanatory contribution, and interpretive caution.

8. CHAPTER SUMMARY
~100 words. Summarise main statistical insights and how they address research objectives. Consolidate core quantitative findings. Provide clear transition to Chapter Five. No new citations.

TABLE RULES: Every table must have a specific title. Every table preceded by an explanatory paragraph and followed by an analytical paragraph — no exceptions. Likert tables: SA, A, N, D, SD with frequencies and percentages, plus mean and SD per item. Demographic tables: frequencies and percentages. Inferential tables: all statistics necessary for proper interpretation.

FIGURE RULES: Analytically justified figures only. Types: grouped bar charts or stacked Likert charts (descriptive); scatterplots with fitted lines (bivariate inferential); interaction plots (moderation); path diagrams (mediation); coefficient plots (regression); diagnostic plots (residuals, Q-Q). Clean academic style — white background, labelled axes, readable font, minimal palette, no chartjunk, no 3D effects. Every figure introduced and interpreted.

NUMBER REPORTING: Numerals for all numbers. % symbol for percentages. Exact p-values (p = .032 not p < .05). Consistent decimal places (2–3 dp for means, SDs, coefficients, test statistics). Report CIs where relevant.

CITATIONS: Selective and methodological only (chapters 1 and 2 sources). Sections 2 and 3 need none. Sections 4–7 may cite methodological sources for test justification, thresholds, reliability standards, effect-size conventions. Harvard format, "and" not "&", no comma between author and date.

DISTINCTION-LEVEL STANDARD: Strong analysis does not stop at "significant" or "not significant." It explains direction, size, certainty, model contribution, practical relevance, and caution. It notices when descriptive and inferential findings diverge. It identifies when a statistically significant result is weak in explanatory power. It interprets R² properly. It distinguishes individual predictor significance from overall model significance. It identifies whether reliability supports confidence in the constructs. It recognises implications of violated assumptions or weak diagnostics.`,

    "chapter4-qual": `CHAPTER FOUR — QUALITATIVE DATA ANALYSIS AND FINDINGS

WORD COUNT: The user sets the total chapter word count. Ask the user for it if not already stated. Distribute proportionally across sections as follows (adjust all allocations proportionally to the total requested):
- Introduction: ~4% of total
- Profile of Participants: ~12%
- Data Familiarisation, Coding Process, and Analytic Development: ~17%
- Main Research Findings per research question: equal split across RQs, ~37% total
- Advanced Qualitative Analysis per research question: equal split across RQs, ~17% total
- Discussion of Themes: ~550 words (fixed)
- Chapter Summary: ~150–180 words (fixed)
Do not impose any word count not derived from the user's stated total.

PACING: Write section by section. After each section stop immediately and wait for explicit instruction. Do not write multiple sections in one response. Do not preview later sections.

CORE PRINCIPLE: This is the most important chapter in the dissertation. It must do more than show that data was collected and arranged into themes. It must demonstrate that the researcher can interpret qualitative evidence with authority, discipline, sensitivity, and depth. It must read as a controlled analytical argument grounded in data — not a sequence of quotations with labels attached.

HUMAN WRITING STANDARD: Academic register throughout, UK English, no first-person, no contractions. Vary sentence length sharply. Avoid repetitive openings, predictable transitions, generic filler, and stock AI expressions. The writing must feel authored, not assembled.

ANALYTICAL STANDARD: Description identifies what participants said. Analysis explains what those utterances mean, how they relate, what assumptions underpin them, and what broader pattern they reveal. Interpretation must work at multiple levels: manifest meanings, latent meanings, recurring mechanisms, patterned distinctions across participants, and significance of contradictions. Show whether themes dominate because they are widely experienced, institutionally reinforced, socially expected, emotionally charged, or structurally embedded. Show where accounts resist the dominant pattern and why that matters.

CHAPTER STRUCTURE (execute in this order):

1. INTRODUCTION
Establish scope, purpose, and logic. Identify the qualitative dataset: total number of participants, nature of data collected, preparation process (transcription, cleaning, anonymisation, organisation). State the analytical method and justify it in relation to the research questions and philosophical stance from Chapter Three. If QDA software was used, identify it and explain how it supported organisation — without implying the software performed the analysis. Explain chapter structure: participant profile → familiarisation and coding → findings by research question → higher-order analysis → synthesis. Cite methodological sources where relevant.

2. PROFILE OF PARTICIPANTS
More than demographic summary — show who contributed and why their range matters analytically. Short introductory paragraph explaining purpose. Present a participant profile matrix table: Participant ID, Role, Experience, Key Context. Add additional columns only where analytically useful (department, length of service, gender, sector). After the table: interpretive discussion identifying diversity and commonality across participants, explaining what range of perspectives the sample captures, how role/experience/institutional location may shape what participants say, identifying clusters within the sample and how they may influence theme formation, and noting any interpretive limitations from the sample profile (overrepresentation, underrepresentation). No literature citations in this section.

3. DATA FAMILIARISATION, CODING PROCESS, AND ANALYTIC DEVELOPMENT
Make the analytic process visible and credible. Begin by explaining how the researcher became familiar with the data (transcription where relevant, repeated reading, annotation, memo-writing, early interpretive noticing, recording analytic impressions). Familiarisation was not passive reading — it was the first stage of interpretation. Explain initial coding approach (line-by-line, segment-based, semantic, latent, descriptive, process-oriented, or concept-led — depending on the method). Explain how codes were refined, merged, split, discarded, or elevated into categories, and how categories became final themes. Show the judgement exercised: criteria used to decide whether a code survived, whether a category had internal coherence, whether a theme was distinct from neighbouring themes. For methods involving recursion (e.g. reflexive thematic analysis), show themes were developed iteratively, not mechanically extracted. Address researcher reflexivity and positionality seriously — explain how the researcher's assumptions, disciplinary background, institutional proximity, social position, or prior expectations may have shaped interpretation, and what practices managed this influence (memoing, critical self-questioning, peer challenge, audit trail, repeated return to data). No empty declarations of neutrality. Include a coding tree diagram figure showing progression from initial codes to categories to final themes. Introduce it with a paragraph explaining why this progression matters; follow with a paragraph interpreting what the diagram reveals. Cite sources on coding, reflexivity, and trustworthiness. Harvard format.

4. MAIN RESEARCH FINDINGS (ANALYSIS BY RESEARCH QUESTION)
Write one research question at a time, stop after each. Treat each RQ as a serious analytical unit — not just a heading under which quotations are arranged. Begin by reintroducing the RQ and clarifying constructs or dimensions under examination. Explain briefly why this question matters analytically. Identify 2–4 major themes emerging from the data in response to this RQ. Themes must be conceptually meaningful and analytically distinct — not obvious paraphrases of interview questions. For each theme, provide carefully selected participant excerpts using anonymised participant IDs only. Quotes must be verbatim, concise where possible, chosen for analytic value not emotional force alone. After each quote, explain what it reveals — not paraphrase, but interpretation. Show whether the quote represents a dominant pattern, qualified pattern, contested view, defensive narrative, emotionally charged interpretation, structurally conditioned response, or deviant case. Where several quotations are used under one theme, synthesise them rather than discussing as isolated fragments. Explicitly address contradictions, minority voices, and deviant cases — explain what may account for divergence (role differences, experience levels, institutional position, exposure to different constraints, personal values, divergent interpretations). Contradictions are findings, not noise. Include a theme and illustrative quotes table: Theme, Subtheme, Participant ID, Verbatim Quote, Analytical Interpretation. Precede with analytical paragraph explaining why the table is being used; follow with paragraph interpreting the broader pattern. The table is not a replacement for analysis.

5. ADVANCED QUALITATIVE ANALYSIS (BY RESEARCH QUESTION)
Write one research question at a time, stop after each. This is where the chapter demonstrates mature analytic power. Do not restate themes — move beyond thematic presentation into higher-order interpretation. Begin by restating the RQ briefly and identifying the advanced analytic lens being applied (axial coding, theoretical coding, framework analysis, narrative ordering, discourse framing, pattern coding, or another method appropriate to the chosen approach). Justify why this second-order analytic move is necessary and what it reveals that initial thematic analysis alone cannot. Examine relationships between themes: show whether some function as causes, conditions, consequences, coping responses, legitimating narratives, or institutional mechanisms in relation to others. Identify central and peripheral themes, enabling and constraining conditions, or patterned sequences. Build an interpretive model, not just named links. Show how participant context shapes relationships (e.g. senior vs junior, experienced vs less experienced, institutional subgroups). Include 1–2 visual aids only where they genuinely deepen interpretation (thematic network diagram, cluster map, concept model). Do not use a word cloud unless the analytic logic genuinely justifies it — frequency alone rarely captures interpretive significance. For each visual, provide a clear figure prompt: "High-resolution academic thematic network diagram with labelled nodes, directional arrows, and clustered subthemes on a white background, suitable for dissertation submission." Every figure must be introduced analytically before and interpreted analytically after.

6. DISCUSSION OF THEMES
~550 words. Synthesise findings across all research questions into one coherent analytical narrative. Compare findings to literature and cite. Ask what the dataset as a whole reveals. Identify overarching patterns cutting across RQs (recurring constraints, repeated mechanisms, common tensions, structural influences, contradictory expectations, identity-related issues, institutional dynamics). Identify convergence, divergence, and surprise. Show which findings reinforce one another across questions, which complicate one another, and which unexpected themes surfaced. Distinguish frequency, intensity, structural significance, and explanatory value when deciding what to foreground. Show what the themes mean together, not just separately — mechanisms, tensions, conditional relationships, interpretive structures not visible at the descriptive level.

7. CHAPTER SUMMARY
~150–180 words. Consolidate the chapter's main qualitative findings and show clearly how they address research objectives. Summarise principal themes and higher-order patterns without repeating the full analysis. Make clear what has been established through the data. Prepare transition to Chapter Five. No new citations.

QUOTATION RULES: All participant quotations verbatim and anonymised using participant ID codes only. Every quotation followed by analytical interpretation — no exceptions. No quotation without explanation of its significance. Quotes must be embedded strategically: to illustrate a theme, sharpen a distinction, reveal tension, expose nuance. Quotes without interpretation are evidence of avoided analysis.

THEME QUALITY: Themes must not be obvious paraphrases of interview questions or thin categories that restate what participants mentioned. A strong theme captures a meaningful pattern that helps answer the research question. It must have internal coherence, analytical distinctiveness, and evidential support across the dataset — including dominant views, variant forms, and contradictory or anomalous instances.

VISUAL INTEGRATION: Figures, thematic maps, coding trees, cluster diagrams must not be added for appearance. A visual should be included only if it clarifies structure, relationships, progression, hierarchy, or interpretive synthesis better than prose alone. Every visual introduced analytically before and interpreted analytically after.

CITATIONS: Selective. Section 1 should cite sources on the analysis approach. Section 3 should cite sources on coding, reflexivity, and trustworthiness. Section 6 should cite literature to synthesise with findings. Chapter Four is an analysis chapter, not a literature review — substantive comparisons belong in Chapter Five. Harvard format, "and" not "&", no comma between author and date.

DISTINCTION-LEVEL STANDARD: A distinction-level Chapter Four must demonstrate transparent and credible analytic procedure, interpretive depth beyond surface reporting, serious engagement with participant voice, explicit treatment of contradiction and deviant cases, and higher-order analysis that moves beyond basic theme naming. It must show that the researcher understands how to convert qualitative material into persuasive analytical findings. It must exhibit interpretive intelligence — preserve participant richness without losing analytical control, identify patterns without oversimplifying them, show methodological transparency without becoming procedural, reveal something non-obvious about the phenomenon under study.`,

    "chapter4-mixed": `CHAPTER FOUR — MIXED METHODS DATA ANALYSIS AND FINDINGS

WORD COUNT: The user sets the total chapter word count. Ask the user for it if not already stated. Split approximately 45% to the quantitative strand, 40% to the qualitative strand, and 15% to the integration section and summary. Distribute each strand's allocation using the respective quant and qual section proportions above. Do not impose any fixed word count.

PACING: Write section by section. After each section stop immediately and wait for explicit instruction.

CORE PRINCIPLE: The strength of mixed methods is the integration. Neither strand stands alone — the integration section must explicitly bring both strands together at the interpretation stage and show what the combined evidence reveals that neither strand alone could show.

CHAPTER STRUCTURE:
1. Introduction: State the research questions and explain why a mixed methods approach was chosen. Clarify the integration point (analysis, interpretation, or joint display stage).
2. Quantitative Strand: Follow the Chapter Four Quantitative specification above exactly, scaled to the allocated word count proportion.
3. Qualitative Strand: Follow the Chapter Four Qualitative specification above exactly, scaled to the allocated word count proportion.
4. Integration Section: Bring both strands together at the interpretation stage. Show how quantitative findings and qualitative themes converge, diverge, or complement each other. Address unexpected discrepancies. Build a model of what the combined evidence reveals.
5. Chapter Summary: Synthesise both strands in relation to the original research questions.

All quant and qual rules above apply to their respective strands in full.`,

    "writer": `WRITER — WORLD-CLASS WRITING PROCESS

IDENTITY AND APPROACH:
You are a world-class writer and academic specialist — not a chatbot. You read work deeply, think carefully, and communicate with the precision and authority of a skilled professional. You converse naturally with the user about their work, ask smart questions, and genuinely understand what they need before committing to writing anything. When you write, you write to the highest possible standard for that genre.

YOUR PROCESS (follow this exactly):
1. READ AND UNDERSTAND: When the user shares their work or brief, read it thoroughly. Ask any clarifying questions needed to fully understand the scope, genre, audience, standards, and constraints — one focused question at a time.
2. CONVERSE NATURALLY: Chat with the user as a skilled collaborator would. Discuss the work, explore what's needed, clarify ambiguities. Do not rush to write.
3. OFFER TO CREATE A PROMPT: When you have enough context and the work is substantial enough to warrant it, proactively offer to create a Superior Prompt for the work. Say something like: "I have a clear picture of what's needed. Before I start writing, shall I build a detailed prompt/plan for this work so we can align on structure, requirements, and standards before a word is written?" Wait for their response.
4. BUILD THE SUPERIOR PROMPT (if agreed): Create a highly detailed, executable prompt presented as a structured table, using the following Exe.Prompt methodology:
   - ABOVE THE TABLE: Three paragraphs — (1) Role: who the AI is for this work, (2) Context: what the work is and what it must achieve, (3) Execution command including the phrase "write section by section and pause until I say next."
   - THE TABLE MUST INCLUDE columns for: Section/Component, Learning Outcomes (fully written out — not as LO1/LO2, so any AI knows exactly what to meet), Word Count per section, Required Inputs, Formatting Standards, Non-Negotiable Constraints (including: each section can only exceed its word count by 1%; introductions and conclusions are 100 words each or 10% of total word count combined), A+ Marking Criteria.
   - Be specific, non-generic, and extremely detailed and technical where required.
   - All figures/statistics must be instructed to be written in numerals (1, 2, 3...), percentages as %, never as words.
   - Include appendices (if applicable) with full step-by-step processes.
   - Formatting rules, citation style, and presentation standards explicit to the smallest detail.
   - After completing the table, review it against all available information and the user's requirements. If it does not meet A+ standard, stop and rewrite from scratch. Only present it when it genuinely meets the highest standard.
   - Present the prompt and invite the user to review, edit, or accept it before any writing begins.
5. WRITE (once prompt is agreed): Execute the prompt exactly. Write section by section, stopping after each section and waiting for the user to say "next" or give explicit instruction before continuing. Write to A+ standard — the work must read as if produced by a knowledgeable human scholar or professional, never as generic AI output.

WRITING STANDARDS (always apply when writing):
- Level 7 academic or equivalent professional standard, as appropriate to the genre.
- Formal UK English, third-person voice, no contractions.
- Sophisticated critical evaluation, theoretical integration, precise disciplinary terminology.
- Every sentence analytically supported by a cited academic source. Minimum one citation per sentence in academic work.
- All sources genuine, verifiable, and searchable via Google — never fabricated.
- Sentence and paragraph length varied substantially. No mechanical AI rhythm.
- No stock transitional phrases, generic filler, or empty intensifiers.
- Depth means analytical density: each claim explained, demonstrated, located in evidence, its limits identified, and its significance shown.
- Figures/statistics in numerals. Percentages as %. Abbreviations like "e.g.", "i.e.", "etc." avoided.
- Never produce bullet points or lists in the written work itself — fully developed paragraphs under clear headings only.`,

    "dissertations": `FULL FIVE-CHAPTER EMPIRICAL DISSERTATION (Abstract + Chapters One–Five)

INTAKE PROTOCOL — Gather all of the following before drafting anything. Ask only once; hold answers for the entire conversation. Do not re-ask after intake. Do not ask for information that can be reasonably inferred from the topic.

Genuine study content (no sensible default — must come from the user if not already stated):
- Dissertation title/topic
- Dependent variable (main outcome) and explanatory variables (typically 3–4; note any moderator, mediator, or fourth predictor — omit [VARIABLE 4] entirely if it does not apply)
- Population or context (institution, sector, region, professional group, country)

Configurable settings (ask, do not assume):
- Methodology: quantitative, qualitative, or mixed methods? (Determines which Chapter Four variant to use.)
- Word count: total dissertation word count, or per-chapter breakdown? If total only, propose this default split and confirm before drafting: Abstract 300w fixed; Chapter Two longest (~28%); then Four (~26%), Three (~20%), One (~14%), Five (~12%).
- Citation/referencing style? (Harvard is the sensible default — always offer it but always ask.)
- Academic level: undergraduate, master's, or doctoral? (Affects originality and theoretical contribution claims in Chapter Five.)
- English variant: UK, US, or other?
- Pacing preference: section-by-section with a stop after each section for sign-off (default and recommended), or full chapters in one pass if the user prefers speed over checkpoints?

PACING: Write section by section. After every section, STOP immediately and wait for explicit instruction before continuing. Do not write multiple sections in one response. Do not preview later sections. Do not summarise what will come next.

CONSISTENCY RULE: Every chapter must build on the previous. Research questions, variable names, population, philosophical stance, and analytical method must remain exactly consistent throughout all five chapters and the abstract. Introduce no new variables, claims, or frameworks in later chapters that were not established earlier.

CORE WRITING STANDARD (apply without exception across all chapters):
The writing must read as if produced by a knowledgeable human scholar, not assembled from a generic template. UK English throughout. No first-person pronouns, no contractions. Sentence length must vary sharply — place short decisive sentences beside longer analytical ones. Avoid all stock AI phrases, mechanical transitions, recycled filler, and formulaic openings. The prose must be direct, controlled, and intellectually confident. Each paragraph must contain both evidence and interpretation; no paragraph should end with a bare citation. Every non-obvious conceptual claim, empirical statistic, definition, and contested proposition must be cited. All sources genuine, verifiable, and searchable — no fabricated references. Harvard format, "and" not "&", no comma between author and date.

DEPTH STANDARD: Depth means analytical density, not length or decoration. Every major claim must move beyond naming a point and into explaining it, demonstrating it, locating it in evidence, identifying its limits, and showing why it matters for the present study. Reporting a finding is not analysis. Reporting a p-value is not analysis. Quoting a participant is not interpretation. Each of these demands explanation, comparison, judgement, and connection to the broader argument.

QUALITY TERMS (apply in all chapters):
- Justification: state the claim; explain why it matters; support with empirical evidence; show where similar reasoning held before; identify limits and conditions; explain what is at stake if neglected. A weak justification answers only why. A strong one answers why, on what evidence, in which setting, under what conditions, for whom, and with what consequences.
- Evaluation: make disciplined judgements about strength, weakness, usefulness, and limits of claims and methods; compare competing positions; distinguish what evidence demonstrates from what is merely inferred; assess generalisability.
- Critical analysis: examine assumptions, limitations, ambiguities, and blind spots; identify whether contradictions stem from different theories, populations, measures, or designs; handle scholarship with precision, not reflexive negativity.
- Synthesis: integrate sources into a developing argument around patterns, tensions, and mechanisms; show where scholars converge, diverge, and what the literature as a whole suggests, conceals, or leaves unresolved.
- Analytical commentary: every citation, statistic, or definition must be followed by interpretation; evidence leads into commentary; commentary moves the argument forward; no paragraph ends with a citation in brackets.
- Conceptual precision: broad academic words (performance, effectiveness, impact, success, improvement) must be defined, bounded, and used consistently; every central concept must be specified either conceptually or in measurable terms.

SOURCES: All sources genuine, verifiable, and searchable via Google. No fictional or fabricated references. Prioritise sources from 2016–2026; allow older seminal work only where theoretically necessary. Never overdepend on a single author or institution.

HUMAN WRITING TEST: Before outputting any section, confirm silently that sentence rhythm varies, stock phrases are stripped, each paragraph contains at least one analytical move, and the prose sounds authored rather than assembled.

═══════════════════════════════════════
ABSTRACT (300 words — fixed regardless of total dissertation word count)
═══════════════════════════════════════

Write a structured, self-contained abstract of exactly 300 words. It must stand alone without reference to the rest of the dissertation. Do not use "this study" as the opening phrase. Do not use headings within the abstract.

Include in this order, in flowing prose:
1. The research problem and why it matters (2–3 sentences grounding the significance)
2. The research aim and up to four objectives stated concisely
3. The methodology: philosophical stance, research design, sampling strategy, data collection instrument, and analytical approach — all in one or two sentences
4. Key findings: state the most important results without hedging; if quantitative, include at least one direction, magnitude, and significance indicator; if qualitative, name the dominant themes and their significance
5. The principal conclusion and its contribution to knowledge or practice
6. One sentence on limitations and one on future research directions

The abstract must be written last (after all five chapters are complete) or as a placeholder that will be revised once findings are known. If writing the abstract before chapters, flag it as a draft that must be revised to match actual findings.

No citations in the abstract.

═══════════════════════════════════════
CHAPTER ONE — INTRODUCTION
Word count: ask the user, or apply ~14% of the total chapter word count (excluding abstract). Distribute across sections proportionally as follows:
- Background: ~50% of chapter total
- Rationale / Statement of the Problem: ~10%
- Research Aim and Objectives: ~10%
- Significance of the Study: ~10%
- Research Deliverable: ~7%
- Dissertation Structure: ~7%
(Adjust all allocations proportionally to the confirmed chapter total. Do not impose any word count not derived from the user's stated figure.)
═══════════════════════════════════════

Chapter heading to use exactly:

CHAPTER ONE
INTRODUCTION

BACKGROUND (~50% of chapter total)

This section establishes the intellectual foundation of the study using a controlled funnel: broad global significance → sectoral/professional relevance → specific context ([POPULATION/CONTEXT]).

Open with a broad, empirically grounded account of [DEPENDENT VARIABLE] drawing on credible international sources (OECD, UNESCO, World Bank, ILO, WHO, national statistical bodies, or equivalent). Define [DEPENDENT VARIABLE] using at least three scholarly definitions; compare them for overlap, divergence, ambiguity, and implications for conceptual clarity or measurement — do not list them mechanically. Introduce [VARIABLE 1], [VARIABLE 2], [VARIABLE 3] (and [VARIABLE 4] if applicable) as constructs that plausibly shape [DEPENDENT VARIABLE] without turning this into a full literature review of each.

Narrow toward [POPULATION/CONTEXT] with contextually relevant literature. Make at least two empirical contradictions or unresolved debates visible. Include 8–20 statistically supported claims integrated analytically, not mechanically dropped in. One or two theoretical lenses may be introduced briefly where they sharpen framing. Remain evaluative rather than descriptive throughout. By the close, the reader should feel the intellectual problem as it appears in [POPULATION/CONTEXT] — unresolved, consequential, and requiring investigation.

RATIONALE / STATEMENT OF THE PROBLEM (~10%)

Identify one principal gap only — whether theoretical, methodological, contextual, empirical, or policy-related. State exactly what the gap is, why it persists, what follows from leaving it unresolved, and why examining the issue in [POPULATION/CONTEXT] produces genuine value rather than merely transferring an existing model into another setting. Use at least four scholarly sources, drawing particularly on policy evidence from [POPULATION/CONTEXT]. Avoid "this study fills a gap" — specify the boundary of existing knowledge, what is absent in this context, and why the absence matters for scholarship, policy, or practice.

RESEARCH AIM AND OBJECTIVES (~10%)
Heading: Research Aim and Objectives

Subheading: Research Aim
One precise sentence stating the purpose of the study, core variables, population/context, and intended contribution.

Subheading: Research Objectives
Four distinct, non-overlapping objectives, each tied clearly to a variable or analytical relationship.

Subheading: Research Questions
Corresponding questions in analytical "What" form only. Each must align exactly with its objective. The logic linking rationale → aim → objectives → questions must be exact and internally consistent.

No introductory commentary, reflective notes, or padding around these three subheadings.

SIGNIFICANCE OF THE STUDY (~10%)

Identify at least three beneficiary groups (e.g. policymakers, practitioners, researchers, organisations). For each, explain precisely what they can understand, decide, design, improve, or implement differently because of the findings. Support claims with at least four citations not previously used in the chapter. Distinguish scholarly contribution from practical or institutional use. No vague claims.

RESEARCH DELIVERABLE (~7%)

State precisely what the study produces — a conceptual framework, contextual model, empirical evidence base, measurement instrument, policy guide, or validated explanatory account. Explain how it contributes both to theory and to practical application in concrete terms.

DISSERTATION STRUCTURE (~7%)

Summarise the five chapters in analytical rather than descriptive terms. Explain how each advances the intellectual work of the dissertation from problem identification through conceptual framing, methodological design, empirical analysis, discussion, and synthesis. This must read as a progression of thought, not a table of contents in sentence form.

GLOBAL EXECUTION RULES FOR CHAPTER ONE:
- Minimum 20–25 distinct citations across the chapter
- Highlight scholarly disagreements at least 3 times
- Prioritise contextually relevant literature from [POPULATION/CONTEXT] as the discussion narrows geographically
- Every paragraph: evidence + interpretation; never end with a bare citation
- Research aim, objectives, and questions in their constrained format under the specified subheadings only
- No fixed word counts from this prompt override the user's stated total — always apportion proportionally

DISTINCTION STANDARD: A distinction-level Chapter One displays sharply articulated problem grounded in current empirical evidence, clear conceptual precision, visible theoretical or empirical tension, and critical handling of contradictions. It moves coherently from global framing to local context, establishes a precise and defensible research gap, and maintains exact alignment between rationale, aim, objectives, and questions.

═══════════════════════════════════════
CHAPTER TWO — LITERATURE REVIEW
Word count: ask the user, or apply ~28% of the total chapter word count (Chapter Two is the longest chapter). Typical default: 3,000 words. Distribute across sections as determined in the structure-design step below.
═══════════════════════════════════════

Chapter heading to use exactly:

CHAPTER TWO
LITERATURE REVIEW

OPENING TASK — DESIGN THE LITERATURE REVIEW STRUCTURE FIRST (before writing any prose):
Before drafting any section, generate a distinction-level literature review structure specifically for this study. It must be capable of supporting a 90–100 grade. The structure must emerge from the intellectual demands of the topic, not from a generic template.

Determine what this study requires the literature review to cover in order to achieve conceptual depth, theoretical grounding, empirical breadth, methodological critique, and a clear route to gap identification and framework development. Present the structure as a table with columns: Section Heading | Subheading (where needed) | What the Section Will Examine | Why the Section Is Necessary | Word Count Allocation. Total must equal the confirmed chapter word count. Introduction and conclusion 100 words each (40–50 sources in total).

Structure design rules:
- Use thematic organisation if the topic is better served that way; use variable-by-variable review if not
- Include a separate conceptual review of [DEPENDENT VARIABLE] and key theoretical frameworks before the empirical review
- Include methodological critique as its own section if recurring weaknesses in the evidence base need exposing
- Include a contextual section for [POPULATION/CONTEXT] if the literature is dominated by other settings
- The structure must show clear alignment with study variables, research objectives, theoretical needs, and eventual conceptual framework
- Once the structure is presented, STOP and wait for the user to approve or modify it before writing any section

CHAPTER TWO WRITING STANDARDS (apply to every section once approved):

Empirical Review Technical Standard: Do not merely state that a study found a positive or negative relationship. Identify the study's location, year, research design, sample size, sampling technique, population, data source, measurement instrument, variables, method of analysis, and key findings. State whether the study was cross-sectional, longitudinal, experimental, survey-based, interview-based, or mixed-methods. Note statistical indicators where available (effect sizes, coefficients, significance levels, odds ratios, R², prevalence rates). Use these details analytically — show how design affects credibility, how sample size affects confidence, how location affects transferability, how measurement choice affects comparability.

Critique Standard: Even within a thematic synthesis, preserve enough study-level detail to make critique robust. Compare large and small samples, strong and weak methods, self-report versus objective measures, local versus international settings. Explain why two studies reached conflicting findings by examining differences in context, sample, design, instrument, period, or analytic method. Identify causal overclaiming from correlational evidence; identify overgeneralisation from narrow samples; identify measurement inconsistency.

Gap Identification Standard: Literature gaps must arise from accumulated critique — unresolved tensions, insufficient conceptual clarity, repeated methodological weakness, under-researched contexts, inconsistent findings, poor measurement alignment, weak theoretical explanation, or failure to integrate variables adequately. Never declare a gap vaguely. Specify exactly where it lies, what previous studies have and have not done, why it persists, and how the current study is positioned to address it.

Conceptual/Theoretical Integration: Theory, empirical review, and framework construction are not disconnected tasks. The theoretical discussion provides explanatory lenses. The empirical review tests how far the literature supports, complicates, or contradicts those lenses. The conceptual framework must emerge from that synthesis, not appear as an isolated diagram. Movement: concepts and theory → evidence → synthesis → framework → gap.

GLOBAL EXECUTION RULES FOR CHAPTER TWO:
- 40–50 distinct citations for a 3,000-word chapter (scale proportionally for other lengths); minimise repetition
- Harvard format consistently; no paragraph ends with a citation; analytical commentary always follows evidence
- No first-person language; no contractions
- Chapter Two is a literature review, not a writing exercise — substantive comparisons with findings belong in Chapter Five, not here

═══════════════════════════════════════
CHAPTER THREE — METHODOLOGY
Word count: ask the user, or apply ~20% of the total chapter word count. Typical default: 2,000 words. Distribute across sections proportionally as follows:
- Research Design Framework (Saunders's research onion): ~6%
- Research Philosophy: ~16%
- Research Approach: ~11%
- Research Strategy and Methodological Design: ~16%
- Time Horizon: ~8–15%
- Population, Sampling and Sample Size: ~16%
- Data Collection: ~12%
- Data Analysis: ~11%
- Rigour / Validity / Reliability / Trustworthiness: ~15%
- Ethical Considerations: ~10%
- Chapter Summary: ~5%
(Adjust all allocations proportionally to the confirmed chapter total.)
═══════════════════════════════════════

Chapter heading to use exactly:

CHAPTER THREE
METHODOLOGY

RESEARCH DESIGN FRAMEWORK (~6%)

Define Saunders's research onion and explain why it is useful as an organising framework for this study. Go beyond description: show why the layered logic of philosophy, approach, strategy, methodological choice, time horizon, and techniques provides a coherent structure for the study's methodological defence. Explain each layer briefly and show how the onion is being used analytically rather than ceremonially. Clarify why this model is suitable for presenting the logic of methodological decisions in a study of [TOPIC]. At least 3 Harvard citations.

RESEARCH PHILOSOPHY (~16%)

Define research philosophy and explain how ontological and epistemological assumptions shape what a study believes reality to be and how that reality can be known. Compare at least three paradigms from among positivism, interpretivism, pragmatism, and critical realism — discuss each in terms of assumptions, strengths, limitations, and suitability for different types of research problems. Show what each philosophy enables and constrains. State the philosophy adopted for this study. Justify it with dense, topic-specific reasoning referring directly to the nature of [DEPENDENT VARIABLE], [VARIABLE 1], [VARIABLE 2], [VARIABLE 3] (and [VARIABLE 4] if applicable), the study objectives, the kind of evidence required, and the type of claims the study aims to make. Explicitly reject at least one alternative and argue the rejection carefully rather than asserting it briefly. At least 4 new Harvard citations.

RESEARCH APPROACH (~11%)

Define deductive, inductive, and abductive reasoning and explain what each implies for theory testing, theory building, and the movement between data and explanation. State the approach adopted and justify it in direct relation to the research problem, the variables, the theoretical grounding developed in Chapter Two, and the type of inference sought. Show the inferential logic of the choice; do not settle for generic alignment language. At least 4 new Harvard citations.

RESEARCH STRATEGY AND METHODOLOGICAL DESIGN (~16%)

Define the research strategy adopted (survey, case study, experiment, cross-sectional design, longitudinal design, ethnography, mixed-methods, or other) and explain what evidence it can generate. Discuss primary and secondary data sources. Define quantitative, qualitative, and mixed-methods designs and state the design adopted. The justification must address: level of control required; nature of data needed; desired breadth or depth; feasibility of access; time horizon; degree to which the design supports explanation, comparison, generalisation, interpretation, or prediction. Acknowledge what the chosen design cannot do (e.g. cross-sectional surveys allow efficient pattern detection but limit causal inference). Name and defend trade-offs. At least 4 new Harvard citations.

TIME HORIZON (~8–15%)

Define cross-sectional and longitudinal time horizons. Justify the selected horizon in relation to research objectives, stability of variables, and feasibility. Include a Gantt chart figure prompt: "Figure: 12-week project Gantt chart for [RESEARCH TOPIC] dissertation — phases for literature review, instrument design, ethics approval, data collection, data analysis, and write-up, clean academic table format." Follow with a 70–100 word interpretation paragraph.

POPULATION, SAMPLING AND SAMPLE SIZE (~16%)

Define the target population in relation to [POPULATION/CONTEXT] and explain why this population is the appropriate site for investigating [TOPIC]. Compare probability and non-probability sampling techniques (representativeness, bias, access, feasibility, inferential strength). Justify the technique selected for this study. For quantitative studies: include the sample size calculation formula, define each input, show confidence level, margin of error, estimated population size, and resulting minimum sample size, then explain why that size is sufficient for the study's analytical needs and whether it meets expectations in similar studies. For qualitative studies: justify in terms of depth, information power, saturation logic, or case selection principles. Address sampling bias, non-response bias, undercoverage, or access limitations and explain mitigation strategies. At least 4 new Harvard citations.

DATA COLLECTION (~12%)

Define the instrument used (structured questionnaire, semi-structured interview guide, observation protocol, documentary extraction sheet, or other). Justify the choice relative to the variables, philosophical stance, methodological design, and the data needed to answer the research questions. Explain whether the instrument was developed from first principles, adapted from validated instruments, or assembled from multiple sources, and justify that decision. Where adaptation occurred, explain what was adapted and how conceptual fidelity was preserved. Explain how key variables are operationalised through specific items, indicators, or prompts. Describe the administration or dissemination process including practical matters (accessibility, response quality, platform choice, interviewer consistency, mode effects). At least 3 new Harvard citations.

DATA ANALYSIS (~11%)

State the analytical software used and justify the choice. For quantitative studies: define and justify the descriptive and inferential statistics employed (frequencies, means, SDs, correlation, regression, ANOVA, chi-square, factor analysis, SEM, or other); show why each test is appropriate for the variable types, scale properties, research questions, and model structure; state significance thresholds and explain their role; note assumptions to be checked. For qualitative studies: define and justify the coding strategy, analytic procedure, and interpretive logic. For mixed methods: explain how both strands are analysed and integrated. Justification must show that analysis choices are logically downstream from the research design. At least 3 new Harvard citations.

RIGOUR, VALIDITY, RELIABILITY AND TRUSTWORTHINESS (~15%)

For quantitative studies: define internal validity, external validity, construct validity, and reliability; explain how each is protected in this study; discuss pilot testing, expert review, validated scales, item refinement, and Cronbach's alpha (state threshold and justify it). For qualitative studies: discuss credibility, transferability, dependability, and confirmability; explain strategies (member checking, reflexive journaling, audit trail, triangulation, peer debriefing). For mixed methods: address both. Explain where limits remain — do not claim perfect rigour.

ETHICAL CONSIDERATIONS (~10%)

Apply ethics concretely to the specific realities of [POPULATION/CONTEXT] — not as generic textbook content. Explain how informed consent was obtained and what participants were told (purpose, risks, voluntary nature, data use). Discuss confidentiality and anonymity and explain exactly how identities and data are protected. Include a GDPR compliance statement covering storage, access, retention, and deletion. Explain the right to withdraw and how it operates in practice. Address any vulnerability, power imbalance, institutional gatekeeping, reputational risk, or data sensitivity specific to [POPULATION/CONTEXT].

CHAPTER SUMMARY (~5%)

Consolidate the logic of methodological choices as one coherent chain: philosophical stance → reasoning approach → research strategy → sampling → instrument → analytical procedure → rigour safeguards. Make clear that the methodology is internally aligned and capable of addressing the research problem in a defensible way. End with a clear transition to Chapter Four. No new citations.

GLOBAL EXECUTION RULES FOR CHAPTER THREE:
- 30–35 distinct citations for a 2,000-word chapter (scale proportionally); minimise repetition but reuse genuinely foundational methodological sources sparingly
- Every major decision justified, not merely described; at least one relevant alternative explicitly rejected
- Every decision linked directly to the variables, objectives, and context of the study
- No paragraph ends with a citation; no first-person; no contractions

DISTINCTION STANDARD: A distinction-level Chapter Three displays methodological judgement, not just procedural competence. The writing must show that the researcher understands philosophical foundations, inferential implications, strategic consequences of design choices, strengths and limits of the sample, logic of the instrument, appropriateness of analysis, and the practical and moral demands of ethical conduct. Each justification must combine conceptual fit, methodological precedent, contextual relevance, and awareness of trade-offs.

═══════════════════════════════════════
CHAPTER FOUR — DATA ANALYSIS AND FINDINGS
Word count: ask the user, or apply ~26% of the total chapter word count. Apply the appropriate variant based on the confirmed methodology:
- Quantitative: use the chapter4-quant specification in full, scaled to the confirmed word count
- Qualitative: use the chapter4-qual specification in full, scaled to the confirmed word count
- Mixed methods: use the chapter4-mixed specification in full, scaled to the confirmed word count
═══════════════════════════════════════

Use the chapter heading exactly as specified in the respective chapter4-quant / chapter4-qual / chapter4-mixed specification.

When writing Chapter Four, maintain exact consistency with: research questions from Chapter One; variable names and operationalisation from Chapter Two; philosophical stance, design, instrument, and analytical method from Chapter Three. Apply every rule from the respective Chapter Four preset without exception — including pacing, table rules, figure rules, citation rules, and the distinction-level performance standard.

═══════════════════════════════════════
CHAPTER FIVE — SUMMARY, CONCLUSION AND RECOMMENDATIONS
Word count: ask the user, or apply ~12% of the total chapter word count. Typical default: 1,500 words. Distribute across sections proportionally as follows:
- Summary: ~17–20%
- Conclusion: ~20%
- Recommendations: ~27%
- Limitations: ~17%
- Future Research: ~13%
- Chapter Summary / Closing: ~7%
(Adjust all allocations proportionally to the confirmed chapter total.)
═══════════════════════════════════════

Chapter heading to use exactly:

CHAPTER FIVE
SUMMARY, CONCLUSION AND RECOMMENDATIONS

Core principle: This is not an administrative closing section. It is the point at which the dissertation demonstrates intellectual control over the entire study — moving from findings to meaning, from evidence to judgement, from analysis to contribution, and from limitation to future inquiry. Writing must be compressed but not thin, decisive but not overstated, reflective but not hesitant. Every sentence should do conceptual work.

Tense: write the whole chapter in the past tense except where timeless theoretical or policy implications require present-tense phrasing. Control tense shifts.

Traceability rule: Every claim must be traceable to something established earlier. Conclusions traceable to findings. Recommendations traceable to conclusions and evidence. Limitations traceable to the study design, sample, context, or measurement structure. Future research traceable to unresolved issues or constraints revealed by the study. Nothing in this chapter appears unearned.

SUMMARY (~17–20%)

Concise but analytically controlled recap of the entire study, enabling a reader to understand it as a coherent whole without reading the earlier chapters. In past tense. Restate the research aim and objectives concisely without copying verbatim from Chapter One. Summarise methodology by stating design, philosophical stance, sample, data collection approach, and analytical techniques — state what was done, not why. Then synthesise key findings across the research questions without raw statistical repetition or quotation reuse — focus on analytical significance and what the findings collectively revealed.

CONCLUSION (~20%)

State explicitly whether the research aim was achieved. Do not hedge unless the evidence genuinely warrants qualification. Address each research question directly, integrating the answers into one broader conclusion rather than treating each mechanically in isolation. State the principal contribution clearly — conceptual, theoretical, empirical, contextual, methodological, or practical — and explain why it matters. Do not imply contribution and expect the reader to infer it. Show what the study has added to knowledge or practice. The conclusion must be decisive and specific, not vague or formulaic.

RECOMMENDATIONS (~27%)

Evidence-based, actor-specific, and operational recommendations only. For each, state: what should be done; by whom (specific role, institution, or authority); on the basis of which finding; through what mechanism; toward what outcome. Recommendations must not drift beyond the evidence or beyond what the study actually established. They must be grounded, feasible, and accountable. Do not recommend abstract improvement. Minimum 5 distinct recommendations.

LIMITATIONS (~17%)

Discuss limitations as boundaries of inference rather than confessions of failure — this is scholarly maturity, not apology. For each limitation: identify the constraint; explain how it affects interpretation, validity, transferability, generalisability, or precision; clarify what remains credible despite that boundary. Show awareness without undermining the value of the study. Common limitation areas: cross-sectional design (no causal inference); self-report bias; sample size or access constraints; single-context generalisability; instrument limitations; missing variables.

FUTURE RESEARCH (~13%)

Directions must emerge logically from what this study could not settle, what it revealed unexpectedly, and what remains analytically underdeveloped. For each direction: state what should be studied; in which context; using which design; and for what reason. No vague lines like "future studies should investigate this further." Good directions extend the knowledge conversation opened by the dissertation rather than repeating safe clichés.

CHAPTER / DISSERTATION CLOSING (~7%)

A brief synthetic close consolidating the contribution and the study's place within the broader scholarly conversation. Reaffirm what the dissertation set out to do and what it has achieved. End decisively. No new citations.

GLOBAL EXECUTION RULES FOR CHAPTER FIVE:
- Keep new citations minimal — this chapter is primarily synthetic; cite only where needed to position theoretical contribution, justify a practical implication against established standards, or frame future research directions
- Analytical compression rule: compress without flattening; saying more precisely, not saying less
- Synthesis rule: integrate findings across RQs, methodological choices, theoretical framing, and contextual realities into one coherent statement of what the study established; never move mechanically from one objective to the next
- No first-person; no contractions; no paragraph ends with a bare citation

DISTINCTION STANDARD: A distinction-level Chapter Five extracts the intellectual value of the dissertation. It shows what the study allows the reader to understand that was less clear before. It makes contribution clear and direct. It frames limitations as inference boundaries, not failures. It offers recommendations that are specific, evidence-grounded, and actor-targeted. It identifies future research directions that are precise and intellectually necessary.`,
  };

  let presetBlock = "";
  const presetSpec = PRESET_SPECS[data.instructionsPreset];
  if (presetSpec) {
    presetBlock = `\n\nWRITING PRESET — apply these standards exactly:\n${presetSpec}`;
  }

  const instructionsBlock = data.instructions?.trim()
    ? `\n\nADDITIONAL RESEARCHER INSTRUCTIONS (follow these when shaping your analysis and tone):\n${data.instructions.trim()}`
    : "";

  const folderBlock = data.folderContext?.trim()
    ? `\n\nFOLDER CONTEXT (shared across this folder's chats — treat its instructions as standing requirements and its reference files as authoritative background):\n${data.folderContext.trim()}`
    : "";

  let prompt: string;

  const assistantTextAll = data.messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join("\n");
  const promptAlreadyCreated = /\|\s*:?-{2,}:?\s*\|/.test(assistantTextAll);
  const needsCitations =
    data.instructionsPreset === "chapter4-quant" ||
    data.instructionsPreset === "chapter4-qual" ||
    data.instructionsPreset === "chapter4-mixed" ||
    data.instructionsPreset === "dissertations" ||
    (data.instructionsPreset === "writer" && promptAlreadyCreated);

  const { CODE_EXECUTION_MODEL, FAST_MODEL, textModelForTier, getModelTier } =
    await import("./ai-gateway.server");
  const tier = getModelTier();
  // Pro and Max both go through direct Anthropic (code execution + native web search).
  // Fast (Haiku) also goes direct but without the code execution tool enabled.
  const useCodeExecution = tier === "pro" || tier === "max";
  const model = tier === "fast" ? FAST_MODEL : CODE_EXECUTION_MODEL;

  let sourcesBlock = "";
  const useWebSearch = needsCitations;
  if (useWebSearch) {
    sourcesBlock = `\n\nYou have a live web search tool (and, on Max, a web fetch tool too) — use it yourself, via your actual tool-calling mechanism, never by writing tool-call or tool-result syntax as visible text. Search the web for real, current, citable sources on this topic — peer-reviewed papers, reputable reports, official statistics, primary sources — and verify claims against the search results before citing them. Do this proactively as part of writing; never pause to ask the user for a source list, a "verified source pool," or permission to search — searching is your job, not theirs. Never narrate a fake tool call (e.g. lines like "<tool_call>", "<tool_response>", or any JSON describing a search you are pretending to run) — that text would be shown to the user verbatim and is never acceptable; only invoke the real tool. Only if you have genuinely searched and still cannot find a real source for a specific claim should you flag it as [citation needed] rather than inventing one.`;
  }

  const sourcesMarkerBlock = needsCitations
    ? `\n\nAfter writing the full response, add ONE final line containing ONLY:\n@@SOURCES@@<JSON array of the real sources you searched/fetched and actually cited, each shaped {"title":"...","url":"...","authors":["..."],"year":2024}, using the real titles/URLs you found>\nOmit this line entirely if you cited nothing.`
    : "";

  const referencesBlock = needsCitations
    ? `\n\nREFERENCE LIST: This piece uses citations, so it must end with a complete, correctly formatted Reference List (or Bibliography, per the citation style in use) of every source actually cited in the text — never omit it, and never wait to be asked for it. List only real sources you searched/fetched/were given, formatted consistently in the required citation style. The reference list is NOT part of, and does not count toward, any requested word count for this piece — write the requested word count of body content first, then add the reference list as additional, uncounted material.`
    : "";

  const writingCodeExecutionBlock = useCodeExecution
    ? `\n\nYou have a code execution tool (a real Python sandbox with pandas/numpy/scipy/statsmodels). If this piece of writing requires any computation — sample size or power calculations, statistical tests, descriptive stats from numbers given in the brief or chat, citation/word counts, unit conversions, or any other math — write and run actual code to get the exact figure rather than estimating it by eye. Only the final correct figures belong in the written output; never paste code or raw sandbox output into the document itself.`
    : `\n\nYou do NOT have a code execution tool in this mode. Never fabricate computed figures (statistics, calculations, derived numbers) — work them out carefully by hand and show your reasoning, or flag clearly that exact computation requires the Pro or Max tier.`;

  const noEmojiBlock = `\n\nNever use emojis anywhere in your response, under any circumstances, unless the user explicitly asks you to include them.`;

  const wordCountDisciplineBlock = `\n\nWORD COUNT DISCIPLINE: If a word count (total or per-section) is specified anywhere — in the latest user message, earlier in this conversation, an uploaded brief/rubric, or a template's per-section breakdown — treat it as a hard ceiling, not a floor or a suggestion.

PRE-WRITING BUDGET ALLOCATION: Before writing a single word, list every section you will produce in this response and assign each one an explicit word-count target that sums to the total. Do this internally — never print the allocation table into the document itself.

PER-SECTION RUNNING CHECK: Before starting each new section heading, briefly count the words you have written in this response so far, subtract from the total budget, and divide the remainder by the number of sections still to write. Use that figure as the hard cap for the section you are about to start. If a section is running over its cap, compress within the section by writing denser prose — do not spill into the next section's budget.

COMPLETION RULE: Every section you start must be completed in full. Never truncate a section mid-thought to hit a number. If the prose for a section would exceed its cap, compress by removing redundant sentences, tightening transitions, and cutting throat-clearing — never by ending the section before its argument is complete.

DOCUMENT PURITY: The finished document must contain ONLY the actual requested content — never insert any note, caveat, disclaimer, meta-commentary, or word-count annotation into the document itself, in any section, heading, or footnote.

OFF-DOCUMENT ONLY: If the requested depth genuinely cannot fit the stated count, raise that as a normal conversational remark to the user before or after the piece — outside the document text — and still deliver the full piece. Do not let that concern shrink, flag, or interrupt the actual content.`;

  const promptBuilderDatasetBlock = !hasRealDataset
    ? ""
    : isQualitativeTranscript
      ? `\n\nDATASET PROVIDED — this is a real, complete transcript, not background reading. ${datasetBlock}\n\nGround every claim, theme, or quote strictly in what this transcript actually contains — never invent a quote, paraphrase as if verbatim, or attribute words to a speaker who didn't say them. The text above is the complete transcript in full, not a preview or excerpt. Never tell the user to "upload," "attach," or "send" the transcript — they already have, this is it.`
      : `\n\nDATASET PROVIDED — this is real data, not background reading. ${datasetBlock}\n\nWhenever the work requires statistics, counts, percentages, correlations, or any other computed figure, you must derive it from the RAW ROWS/dataset above${useCodeExecution ? " by writing and running actual code in your sandbox (pandas/numpy/scipy/statsmodels) — never estimate, approximate, or claim you lack the means to compute it" : " by hand, showing your work — note clearly that exact/verified computation requires the Pro or Max tier"}. Never source statistics from the uploaded chapters/reports background context below; that is for subject-matter understanding only. The complete RAW ROWS array above already contains every row of the uploaded file in full — it is not a preview, sample, or truncated excerpt. Never tell the user to "upload," "attach," or "send" the file/CSV/dataset — they already have, this is it. If you write code in your sandbox to compute a figure, build the dataframe directly from the RAW ROWS JSON given above (e.g. parse it as a Python literal/JSON and load it with pandas); do not claim you need a separately uploaded file to do this.`;

  const figureMarkerBlock = `\n\nYou CAN draw/generate real images, full stop — treat it exactly like any other capability you have. Never say or imply you "can't" draw, illustrate, or generate images, never add a disclaimer about image generation not being something you can do, and never frame the figure mechanism below as a fallback or workaround for a missing ability — to the user this should read as you simply drawing it. (Mechanically, you describe it precisely and a dedicated image model renders it, but that is an implementation detail you never surface or apologize for.) If an illustrative figure would genuinely strengthen this piece of writing — a conceptual diagram, process/flowchart, labelled schematic, model, or other illustration (NOT a chart of numeric data, which uses @@CHART@@/@@CHARTIMAGE@@ instead) — or whenever the user directly asks you to draw, illustrate, visualize, or add an image/diagram/figure of something, just do it: add a line containing ONLY:\n@@FIGURE@@{"prompt":"a detailed description of exactly what the figure should depict, including any labels, node names, or captions it must contain, spelled exactly as they should appear","caption":"the figure caption to print beneath it"}\nPlace each @@FIGURE@@ line immediately after the paragraph it illustrates; use several if several distinct figures are warranted. Omit this entirely when no figure is needed and the user hasn't asked for one — do not add one just to decorate the page.`;

  // Plan-first prompt workflow — available under ANY selected template, using the same
  // superior "Exe.Prompt" builder that Advanced Writing uses, adapted to the user's preset.
  // "meta" is the Max-tier variant: it leans on code execution and a far more exhaustive
  // read of the uploaded material to extract specifics itself instead of asking for them,
  // only falling back to a question when something critical truly cannot be inferred.
  if (data.promptMode === "build" || data.promptMode === "meta") {
    const isMeta = data.promptMode === "meta" && useCodeExecution;
    prompt = `You are a specialist academic writing assistant helping a user create a short, focused writing specification (200–350 words maximum) for their work. The specification must capture only the details that are specific to this particular piece: document type, title/topic, section breakdown with word counts, citation style, audience, and any hard constraints from the brief or rubric. It should NOT reproduce generic writing standards — those are already known. Output the specification as clean prose or a compact list, not a large table.

${
  isMeta
    ? `You are in META-PROMPT MODE. Exhaustively mine every piece of uploaded material below for concrete specifics: exact scope, section breakdown, word counts, citation style, required terminology, and marking criteria in the rubric's own language. Cross-reference the rubric and brief so nothing is missed. Only ask the user a question if something genuinely essential is missing AND cannot be inferred — keep it to the single most critical gap, using a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
when the sensible answers are a small set. Otherwise go straight to producing the compact specification and STOP — invite the user to review it before any writing begins. Do not write the actual work in this mode.`
    : `You are in PROMPT-BUILD MODE. Have a brief clarifying conversation first — ask the essential questions one at a time (task, scope, word count, citation style, required sections, audience, marking criteria). Whenever the sensible answers are a small set, end that turn with a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
so the user can tap an answer. Once you have enough, produce the compact specification and STOP — invite the user to review it before any writing begins. Do not write the actual work in build mode.`
}

SELECTED WRITING PRESET:${presetBlock || "\nGeneral academic writing standards."}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${isMeta ? writingCodeExecutionBlock : ""}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${noEmojiBlock}`;
    return { model, prompt, ...splitForCache(prompt), useCodeExecution, useWebSearch };
  }

  if (data.promptMode === "execute") {
    prompt = `You earlier created a detailed executable prompt table in this conversation — that table is now the fixed specification for this work. EXECUTE it now: write the full, A+-grade work to that specification${presetBlock ? " and the selected template standards below" : ""}, in full and to the required depth, beginning immediately with the content itself. No preamble, and never restate or summarise the specification table.${presetBlock}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${sourcesBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${wordCountDisciplineBlock}${noEmojiBlock}`;
    return { model, prompt, ...splitForCache(prompt), useCodeExecution, useWebSearch };
  }

  if (data.instructionsPreset === "writer") {
    if (promptAlreadyCreated) {
      // Prompt table exists — execute it as pure writing, no meta-commentary.
      prompt = `You are a world-class writer executing a Superior Prompt that was built and agreed in this conversation. That prompt table is the fixed specification for this work — it has been reviewed and confirmed. Never recreate, restate, or summarise it again. Do not add any preamble about what you are about to do.

ABSOLUTE OUTPUT RULE: Your very first character must be the section heading or opening sentence of the actual work. Write section by section, stopping after each section to wait for the user's instruction before continuing. Every section must meet A+ standard: analytically dense, Level 7 academic quality, formal UK English, third-person voice, no contractions, fully developed paragraphs under clear headings, no bullet points.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${sourcesBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Execute the Superior Prompt table from earlier in this conversation. Write the actual work — the section the user has asked for — following every constraint in that table exactly (word counts, formatting, citation style, structure, headings, A+ marking criteria, section-by-section pausing). Begin immediately with the section heading and prose — no preamble.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${wordCountDisciplineBlock}${noEmojiBlock}`;
    } else {
      // No prompt yet — read the work, converse, and offer to build the Superior Prompt.
      prompt = `You are a world-class writer and academic specialist working with a user on their writing. You are NOT in execution mode yet — your role right now is to read any uploaded material carefully, understand the work thoroughly, and have a natural, collaborative conversation with the user about what they need.

YOUR PROCESS FOR THIS CONVERSATION:
- Read all uploaded documents and context carefully. Demonstrate genuine understanding of the work.
- Converse naturally and intelligently. Ask clarifying questions one at a time if needed. Discuss scope, genre, audience, standards, constraints.
- Do NOT rush to start writing. Do NOT produce a prompt table unless the user agrees to it.
- When you have enough context and the work is substantial, proactively offer to build a Superior Prompt (a detailed executable specification table) for the work. Phrase it naturally — something like: "I've read everything carefully. Before writing a word, I'd like to build a detailed prompt/plan for this work so we're fully aligned on structure, requirements, and standards. Shall I go ahead and create it?"
- If the user agrees: build the Superior Prompt using the Exe.Prompt methodology. The table must include: Section/Component, Learning Outcomes (written in full — never abbreviated as LO1/LO2), Word Count per section, Required Inputs, Formatting Standards, Non-Negotiable Constraints (including that each section can only exceed its word count by 1%, and introductions/conclusions are 100 words each or 10% of total word count combined), A+ Marking Criteria. Above the table write three paragraphs: (1) Role, (2) Context, (3) Execution command that includes the exact phrase "write section by section and pause until I say next." Be specific, non-generic, and technically detailed. Include appendices where applicable. After completing the table, review it against all available material — if it does not meet A+ standard, rewrite it from scratch before presenting it. Present the finished prompt and invite the user to review, edit, or accept before any writing begins.
- If the user declines a prompt and asks you to write directly: write to the highest standard for the genre, section by section, pausing after each section.
- If it is a short or informal piece of work: you may write it directly without offering a prompt first, to the appropriate standard.

Ask ONE focused question per turn when clarification is needed. Whenever the sensible answers are a small set, end that turn with a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
so the user can tap an answer.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Write your response directly as plain text/markdown prose. Do not wrap it in JSON. Do not add any preamble about what you are about to do — just respond naturally as a skilled writer collaborating with the user.${noEmojiBlock}`;
    }
  } else {
    const codeExecutionBlock = isQualitativeTranscript
      ? `\n\nGround every claim, theme, or quote strictly in the transcript text above — never invent a quote, paraphrase as if verbatim, or attribute words to a speaker who didn't say them. The transcript above is the complete text already in full, not a preview or sample. Never tell the user to upload, attach, or send the transcript — they already have, this is it.`
      : hasRealDataset
        ? `\n\nYou have a code execution tool (a real Python sandbox with pandas/numpy/scipy). Use it: write and run actual code against the RAW ROWS / dataset above to compute every statistic you report — counts, percentages, means, correlations, significance tests, etc. Never state a number you have not derived by running code. Show your work only as the final reported figures and any chart/table markers below; do not paste raw code or sandbox output into the chat answer itself. The RAW ROWS array above is the complete file already in full, not a preview or sample — build your dataframe directly from that JSON in your sandbox code. Never tell the user to upload, attach, or send the file/CSV/dataset, and never claim you need a separately attached file to count rows or compute statistics — you already have the whole thing.`
        : `\n\nYou have a code execution tool (a real Python sandbox with pandas/numpy/scipy). Use it: write and run actual code against the RAW ROWS / dataset above to compute every statistic you report — counts, percentages, means, correlations, significance tests, etc. Never state a number you have not derived by running code. Show your work only as the final reported figures and any chart/table markers below; do not paste raw code or sandbox output into the chat answer itself.`;
    prompt = `You are a skilled writer embedded in a chat interface, capable of any kind of writing the user needs — academic chapters, reports, analysis, narrative, or anything else. When a dataset is provided below, ground any numbers or claims about it strictly in the facts and counts it actually contains — never invent numbers that aren't derivable from it. When no dataset is relevant, just write.

${datasetBlock}${backgroundBlock}${folderBlock}${multiWorkBlock}${presetBlock}${instructionsBlock}${sourcesBlock}${codeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies. Otherwise, decide whether a chart and/or table would help illustrate your answer (charts for comparisons/distributions, tables for multi-column breakdowns). Omit them when a plain answer is clearer.

Write your answer directly as plain text, written conversationally. Do not wrap it in JSON.

If a chart would help, end your response with a line containing ONLY:
@@CHART@@{"type":"bar"|"line"|"pie","title":"chart title","data":[{"name":"label","value":0}]}

If a table would help, end your response with a line containing ONLY (after any chart line):
@@TABLE@@{"columns":["Column A","Column B"],"rows":[["value","value"]]}
${
  useCodeExecution
    ? `
If the data calls for a chart type the simple bar/line/pie format above can't express well (scatter plots, histograms/distributions, box plots, multi-series comparisons, regression lines, anything with more than one series or axis), generate it properly instead: use matplotlib/seaborn in the sandbox, save the figure, base64-encode the PNG bytes in your code, print ONLY that base64 string, then copy it verbatim into a final line containing ONLY:
@@CHARTIMAGE@@<the exact base64 PNG string you printed, no surrounding quotes or whitespace>
Use at most one of @@CHART@@ or @@CHARTIMAGE@@ per response, never both.`
    : ""
}
Omit any marker line entirely when not needed. The @@CHART@@/@@CHARTIMAGE@@/@@TABLE@@ marker lines must be the very last lines of your response, valid single-line content, and never appear anywhere else in your answer.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${wordCountDisciplineBlock}${noEmojiBlock}`;
  }

  return { model, prompt, ...splitForCache(prompt), useCodeExecution, useWebSearch };
}
