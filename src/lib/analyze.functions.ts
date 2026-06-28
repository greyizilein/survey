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
      "other-writing",
      "basic-academia",
      "dissertations",
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
  // Instead, each preset maps to a compact inline spec that tells the model what standards
  // to apply without reproducing thousands of template words in every message.
  const PRESET_SPECS: Record<string, string> = {
    "chapter4-quant": "Chapter Four — Quantitative Data Analysis and Findings. 4,000 words. Sections: introduction (~150w), data screening and preparation (~300w), descriptive statistics with a formatted table (~400w), inferential statistics per research question/hypothesis (one sub-section each, ~400w each), key findings summary (~300w). Write section by section, stop after each, wait for explicit go-ahead. Every statistic must be computed from the real dataset using the code execution tool. Use APA 7th in-text citations. All figures as numerals. No section may exceed its word count by more than 1%.",
    "chapter4-qual": "Chapter Four — Qualitative Data Analysis and Findings. 4,000 words. Sections: introduction (~150w), analytical approach and positionality (~300w), theme presentation (3–5 themes, one sub-section each of ~500–700w with participant quotes), cross-cutting discussion (~400w), key findings summary (~300w). Write section by section, stop after each, wait for go-ahead. Quote only what the transcript actually contains — never paraphrase as verbatim. Participant references by pseudonym or code. Use Harvard in-text citations unless specified otherwise.",
    "chapter4-mixed": "Chapter Four — Mixed Methods Data Analysis and Findings. 7,000 words: quantitative strand (~3,000w), qualitative strand (~2,400w), integration section (~1,100w), summary (~250w). Each strand follows its respective quantitative/qualitative chapter four structure above. The integration section explicitly brings both strands together at the interpretation stage. Write section by section, stop after each section, wait for go-ahead. Quantitative statistics computed via code execution tool. Qualitative quotes only from real transcript data.",
    "basic-academia": "Level 7 academic writing. Formal UK English, third-person voice, no contractions. Sophisticated critical evaluation, theoretical integration, precise disciplinary terminology. Every sentence analytically supported by a cited academic source. Minimum citation density: at least one citation per sentence. All sources genuine and verifiable. Harvard referencing unless otherwise specified. Introduction and conclusion each ~10% of the total word count combined. Argument must demonstrate mature scholarly engagement — not descriptive narration.",
    "dissertations": "Full five-chapter empirical dissertation (Abstract + Chapters One–Five). Run the intake protocol first (title, dependent variable, explanatory variables, population, methodology, word count split, citation style, academic level, pacing preference) — ask only once, hold answers for the whole conversation. Default pacing: write section by section, stop after each section, wait for go-ahead. Chapter Two is usually the longest, then Four, then Three, One, Five; Abstract is 250–350 words fixed. Apply the appropriate Chapter Four variant (quantitative, qualitative, or mixed) based on the chosen methodology. All sources genuine and verifiable.",
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
    data.instructionsPreset === "basic-academia" ||
    data.instructionsPreset === "dissertations" ||
    (data.instructionsPreset === "other-writing" && promptAlreadyCreated);

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

  const wordCountDisciplineBlock = `\n\nWORD COUNT DISCIPLINE: If a word count (total or per-section) is specified anywhere — in the latest user message, earlier in this conversation, an uploaded brief/rubric, or a template's per-section breakdown — treat it as a hard ceiling, not a floor or a suggestion. Before you start writing, decide how to allocate that count across the sections you're about to produce. While drafting, keep a running mental tally of words written so far and actively budget what's left as you approach the target; do not let any single section silently run long and crowd out the others. Aim to land within about 10% of the requested count (slightly under is fine; do not come in at double or more) by writing tighter, denser prose — never by cutting a section short or leaving it unfinished. Every section you start must be completed in full; if you are running over budget, compress earlier sections in your next draft rather than truncating the current one. The finished document must contain ONLY the actual requested content — never insert any note, caveat, disclaimer, or meta-commentary about word counts, length, or budgeting into the document itself, in any section, heading, or footnote. If the requested depth genuinely cannot fit the stated count, raise that as a normal conversational remark to the user before or after the piece — outside the document text — and keep writing the full piece regardless; do not let that concern shrink, flag, or interrupt the actual content.`;

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

  if (data.instructionsPreset === "other-writing") {
    if (promptAlreadyCreated) {
      prompt = `You previously created an executable prompt table earlier in this conversation (a structured table defining section breakdown, learning outcomes, word counts, required inputs, formatting standards, non-negotiable constraints, and A+ marking criteria). That table is now the fixed specification for this work — it has already been created and confirmed. Never recreate, restate, regenerate, summarise, preview, or modify that table again for the rest of this conversation, no matter what the user asks next, unless they explicitly ask you to revise the prompt/specification itself.

ABSOLUTE OUTPUT RULE FOR THIS TURN: This response must contain ONLY the requested academic content — the actual section/chapter prose (with its own heading, tables of data/results if the section itself requires one as content, and figures), and nothing else. Specifically forbidden anywhere in this response: any markdown table that restates section breakdowns, word counts, learning outcomes, formatting standards, constraints, or marking criteria; any restatement or paraphrase of the specification; any preamble such as "Here is...", "Based on the prompt...", "I will now write...", or a summary of what you are about to do; any meta-commentary about the table, the task, or your process. Your very first character must be the start of the section's actual heading or opening sentence — go straight into the academic writing itself, exactly as if you were a writer who already has the brief memorised and is simply continuing the document.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${sourcesBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message by EXECUTING the previously created prompt table: write the actual academic work it specifies — the section, chapter, or full piece the user is now asking for — following every constraint in that table exactly (word counts, formatting, citation style, structure, headings, A+ marking criteria, "write section by section and pause until I say next", etc). Write the real content itself, in full, to the required depth and standard, beginning immediately with the section's heading and prose per the ABSOLUTE OUTPUT RULE above.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${wordCountDisciplineBlock}${noEmojiBlock}`;
    } else {
      prompt = `You are a specialist academic and professional writing assistant. The user has selected the Advanced Writing mode for work that falls outside the standard chapter/dissertation presets — business reports, executive briefs, proposals, white papers, articles, consultancy deliverables, or academic writing with a bespoke structure from an uploaded brief or rubric.

Your job right now is to have a brief intake conversation to gather what you need, then produce a compact writing specification (200–350 words) that captures only the specifics of this particular piece: document type, section breakdown with word counts, citation style, audience, and hard constraints from the brief. Do NOT produce generic writing advice — only the specifics for this piece. Once the specification is agreed, STOP and invite the user to give the go-ahead before writing begins.

Ask ONE focused question per turn. Whenever the sensible answers are a small set, end that turn with a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
so the user can tap an answer.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${multiWorkBlock}${instructionsBlock}${promptBuilderDatasetBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Write your response directly as plain text/markdown prose. Do not wrap it in JSON. Do not add any preamble about what you're about to do — just write the response itself.${noEmojiBlock}`;
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
