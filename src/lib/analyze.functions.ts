import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100000),
});

export const AnalyzeChatInput = z.object({
  messages: z.array(ChatMessage).min(1).max(40),
  source: z.union([
    z.object({ type: z.literal("project"), project_id: z.string().uuid() }),
    z.object({
      type: z.literal("file"),
      filename: z.string().max(200),
      rows: z.array(z.record(z.string(), z.unknown())).max(5000),
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

export async function buildAnalyzePrompt(
  data: z.infer<typeof AnalyzeChatInput>,
  supabase: any,
): Promise<{ model: string; prompt: string; useCodeExecution: boolean; useWebSearch: boolean }> {
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
  }

  const history = data.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");

  const backgroundBlock = data.background?.trim()
    ? `\n\nBACKGROUND CONTEXT (from uploaded chapters/reports — use this to understand the subject matter, never as a source of statistics):\n${data.background.trim()}`
    : "";

  const multiWorkBlock = data.background?.trim()
    ? `\n\nMULTI-WORK CHECK: Look at the background context above. If it contains more than one distinct piece of work, brief, assignment, or task (for example several separate questions, case studies, chapters, projects, or briefs bundled into the same upload), do not start producing output yet. Instead, briefly list the distinct pieces of work you can identify, ask the user which one (or which ones, and in what order) they want you to focus on, and ask any other clarifying questions you genuinely need about scope, requirements, or priorities — the way a thoughtful human collaborator would. Keep the conversation going naturally across turns, answering the user's questions and asking your own, until both of you are clearly aligned and the user confirms they are ready to begin. Only once that confirmation is given should you proceed to produce the actual requested output. If the background context clearly contains only one piece of work, skip this check and proceed normally.`
    : "";

  let presetBlock = "";
  if (data.instructionsPreset === "chapter4-quant") {
    const { QUANT_CHAPTER_FOUR_TEMPLATE } = await import("./analyze-templates.server");
    presetBlock = `\n\nCHAPTER FOUR (QUANTITATIVE) WRITING TEMPLATE — follow this exactly for structure, formatting, depth, and word counts:\n${QUANT_CHAPTER_FOUR_TEMPLATE}`;
  } else if (data.instructionsPreset === "chapter4-qual") {
    const { QUAL_CHAPTER_FOUR_TEMPLATE } = await import("./analyze-templates.server");
    presetBlock = `\n\nCHAPTER FOUR (QUALITATIVE) WRITING TEMPLATE — follow this exactly for structure, formatting, depth, and word counts:\n${QUAL_CHAPTER_FOUR_TEMPLATE}`;
  } else if (data.instructionsPreset === "chapter4-mixed") {
    const { MIXED_CHAPTER_FOUR_TEMPLATE } = await import("./analyze-templates.server");
    presetBlock = `\n\nCHAPTER FOUR (MIXED METHODS) WRITING TEMPLATE — follow this exactly for structure, formatting, depth, and word counts:\n${MIXED_CHAPTER_FOUR_TEMPLATE}`;
  } else if (data.instructionsPreset === "basic-academia") {
    const { BASIC_ACADEMIA_TEMPLATE } = await import("./analyze-templates.server");
    presetBlock = `\n\nBASIC ACADEMIA WRITING TEMPLATE — follow this exactly for tone, citation density, structure, and quality standards:\n${BASIC_ACADEMIA_TEMPLATE}`;
  } else if (data.instructionsPreset === "dissertations") {
    const { DISSERTATION_WRITER_TEMPLATE } = await import("./analyze-templates.server");
    presetBlock = `\n\nDISSERTATION WRITER TEMPLATE — follow this exactly for intake, chapter ordering, drafting discipline, structure, formatting, citation density, and quality standards across the whole five-chapter dissertation plus abstract:\n${DISSERTATION_WRITER_TEMPLATE}`;
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

  const { CODE_EXECUTION_MODEL, textModelForTier, getModelTier } =
    await import("./ai-gateway.server");
  const tier = getModelTier();
  const useCodeExecution = tier === "max";
  const model = useCodeExecution ? CODE_EXECUTION_MODEL : textModelForTier(tier);

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
    : `\n\nYou do NOT have a code execution tool in this mode. Never fabricate computed figures (statistics, calculations, derived numbers) — work them out carefully by hand and show your reasoning, or flag clearly that exact computation requires the Max tier.`;

  const noEmojiBlock = `\n\nNever use emojis anywhere in your response, under any circumstances, unless the user explicitly asks you to include them.`;

  const promptBuilderDatasetBlock = hasRealDataset
    ? `\n\nDATASET PROVIDED — this is real data, not background reading. ${datasetBlock}\n\nWhenever the work requires statistics, counts, percentages, correlations, or any other computed figure, you must derive it from the RAW ROWS/dataset above${useCodeExecution ? " by writing and running actual code in your sandbox (pandas/numpy/scipy/statsmodels) — never estimate, approximate, or claim you lack the means to compute it" : " by hand, showing your work — note clearly that exact/verified computation requires the Max tier"}. Never source statistics from the uploaded chapters/reports background context below; that is for subject-matter understanding only. The complete RAW ROWS array above already contains every row of the uploaded file in full — it is not a preview, sample, or truncated excerpt. Never tell the user to "upload," "attach," or "send" the file/CSV/dataset — they already have, this is it. If you write code in your sandbox to compute a figure, build the dataframe directly from the RAW ROWS JSON given above (e.g. parse it as a Python literal/JSON and load it with pandas); do not claim you need a separately uploaded file to do this.`
    : "";

  const figureMarkerBlock = `\n\nYou CAN draw/generate real images, full stop — treat it exactly like any other capability you have. Never say or imply you "can't" draw, illustrate, or generate images, never add a disclaimer about image generation not being something you can do, and never frame the figure mechanism below as a fallback or workaround for a missing ability — to the user this should read as you simply drawing it. (Mechanically, you describe it precisely and a dedicated image model renders it, but that is an implementation detail you never surface or apologize for.) If an illustrative figure would genuinely strengthen this piece of writing — a conceptual diagram, process/flowchart, labelled schematic, model, or other illustration (NOT a chart of numeric data, which uses @@CHART@@/@@CHARTIMAGE@@ instead) — or whenever the user directly asks you to draw, illustrate, visualize, or add an image/diagram/figure of something, just do it: add a line containing ONLY:\n@@FIGURE@@{"prompt":"a detailed description of exactly what the figure should depict, including any labels, node names, or captions it must contain, spelled exactly as they should appear","caption":"the figure caption to print beneath it"}\nPlace each @@FIGURE@@ line immediately after the paragraph it illustrates; use several if several distinct figures are warranted. Omit this entirely when no figure is needed and the user hasn't asked for one — do not add one just to decorate the page.`;

  // Plan-first prompt workflow — available under ANY selected template, using the same
  // superior "Exe.Prompt" builder that Advanced Writing uses, adapted to the user's preset.
  // "meta" is the Max-tier variant: it leans on code execution and a far more exhaustive
  // read of the uploaded material to extract specifics itself instead of asking for them,
  // only falling back to a question when something critical truly cannot be inferred.
  if (data.promptMode === "build" || data.promptMode === "meta") {
    const isMeta = data.promptMode === "meta" && useCodeExecution;
    const { OTHER_WRITING_TEMPLATE } = await import("./analyze-templates.server");
    prompt = `${OTHER_WRITING_TEMPLATE}

${
  isMeta
    ? `You are in META-PROMPT MODE, the deepest version of this builder. Before writing anything, exhaustively mine every piece of uploaded material below — the brief, rubric, instructions, and any files — for every concrete detail an executable prompt needs: exact scope and deliverables, section-by-section breakdown, word counts, formatting/citation style, required terminology, marking criteria phrased in the rubric's own language, and any numeric or structural constraints. Cross-reference the rubric against the brief so nothing it implies is missed. Pull exact phrasing/keywords from the source material into the prompt table itself rather than paraphrasing generically. Only ask the user a clarifying question if something genuinely essential is missing AND cannot be reasonably inferred from the material provided — and if you do, keep it to the single most important gap, using a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
when the sensible answers are a small set. Otherwise, skip the back-and-forth entirely and go straight to producing the single executable prompt table, made as specific and domain-accurate as the source material allows, and STOP — invite the user to review it and give the go-ahead before any writing begins. Do not write the actual work in this mode.`
    : `You are in PROMPT-BUILD MODE. Before producing the executable prompt table, FIRST have a brief clarifying conversation with the user. Ask the essential questions you need (exact task, scope, total and per-section word count, citation/referencing style, required sections, audience, marking criteria, and which uploaded material to use). Ask ONE focused question per turn. Whenever the sensible answers are a small set, end that turn with a line containing ONLY:
@@OPTIONS@@{"options":["First option","Second option","Third option"]}
so the user can simply tap an answer (they may also type their own). Keep this up across turns until you genuinely have enough. THEN produce the single executable prompt table exactly as instructed above, adapted to the user's selected writing template below, and STOP — invite the user to review it and give the go-ahead before any writing begins. Do not write the actual work in build mode.`
}

SELECTED WRITING TEMPLATE TO ADAPT THE PROMPT TO:${presetBlock || "\nGeneral academic standards."}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${isMeta ? writingCodeExecutionBlock : ""}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${noEmojiBlock}`;
    return { model, prompt, useCodeExecution, useWebSearch };
  }

  if (data.promptMode === "execute") {
    prompt = `You earlier created a detailed executable prompt table in this conversation — that table is now the fixed specification for this work. EXECUTE it now: write the full, A+-grade work to that specification${presetBlock ? " and the selected template standards below" : ""}, in full and to the required depth, beginning immediately with the content itself. No preamble, and never restate or summarise the specification table.${presetBlock}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${sourcesBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${noEmojiBlock}`;
    return { model, prompt, useCodeExecution, useWebSearch };
  }

  if (data.instructionsPreset === "other-writing") {
    if (promptAlreadyCreated) {
      prompt = `You previously created an executable prompt table earlier in this conversation (a structured table defining section breakdown, learning outcomes, word counts, required inputs, formatting standards, non-negotiable constraints, and A+ marking criteria). That table is now the fixed specification for this work — it has already been created and confirmed. Never recreate, restate, regenerate, summarise, preview, or modify that table again for the rest of this conversation, no matter what the user asks next, unless they explicitly ask you to revise the prompt/specification itself.

ABSOLUTE OUTPUT RULE FOR THIS TURN: This response must contain ONLY the requested academic content — the actual section/chapter prose (with its own heading, tables of data/results if the section itself requires one as content, and figures), and nothing else. Specifically forbidden anywhere in this response: any markdown table that restates section breakdowns, word counts, learning outcomes, formatting standards, constraints, or marking criteria; any restatement or paraphrase of the specification; any preamble such as "Here is...", "Based on the prompt...", "I will now write...", or a summary of what you are about to do; any meta-commentary about the table, the task, or your process. Your very first character must be the start of the section's actual heading or opening sentence — go straight into the academic writing itself, exactly as if you were a writer who already has the brief memorised and is simply continuing the document.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${instructionsBlock}${promptBuilderDatasetBlock}${sourcesBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message by EXECUTING the previously created prompt table: write the actual academic work it specifies — the section, chapter, or full piece the user is now asking for — following every constraint in that table exactly (word counts, formatting, citation style, structure, headings, A+ marking criteria, "write section by section and pause until I say next", etc). Write the real content itself, in full, to the required depth and standard, beginning immediately with the section's heading and prose per the ABSOLUTE OUTPUT RULE above.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${noEmojiBlock}`;
    } else {
      const { OTHER_WRITING_TEMPLATE } = await import("./analyze-templates.server");
      prompt = `${OTHER_WRITING_TEMPLATE}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${folderBlock}${multiWorkBlock}${instructionsBlock}${promptBuilderDatasetBlock}${writingCodeExecutionBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies — otherwise produce the executable prompt table as instructed above.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON. Do not add any preamble about what you're about to do — just write the response itself.${noEmojiBlock}`;
    }
  } else {
    const codeExecutionBlock = hasRealDataset
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
Omit any marker line entirely when not needed. The @@CHART@@/@@CHARTIMAGE@@/@@TABLE@@ marker lines must be the very last lines of your response, valid single-line content, and never appear anywhere else in your answer.${figureMarkerBlock}${referencesBlock}${sourcesMarkerBlock}${noEmojiBlock}`;
  }

  return { model, prompt, useCodeExecution, useWebSearch };
}
