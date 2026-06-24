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
  background: z.string().max(8000).optional(),
  instructionsPreset: z.enum(["none", "chapter4-quant", "chapter4-qual", "chapter4-mixed", "other-writing", "basic-academia"]).default("none"),
  instructions: z.string().max(4000).optional(),
});

const DocFile = z.object({ name: z.string().max(200), data: z.string() });
const SummarizeDocsInput = z.object({ files: z.array(DocFile).min(1).max(8) });

export const summarizeAnalysisDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummarizeDocsInput.parse(d))
  .handler(async ({ data }) => {
    const { extractText } = await import("./interviews.functions");
    const texts: string[] = [];
    for (const f of data.files) {
      const t = await extractText(f.data, f.name);
      texts.push(`===== FILE: ${f.name} =====\n${t}`);
    }
    let combined = texts.join("\n\n");
    const MAX = 50_000;
    if (combined.length > MAX) combined = combined.slice(0, MAX) + "\n…[truncated]";

    const RAW_PASSTHROUGH_LIMIT = 7800;
    if (combined.length <= RAW_PASSTHROUGH_LIMIT) {
      return { summary: combined.trim() };
    }

    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const prompt = `Condense the following written material (chapters, reports, briefs, assignments, methodology, notes) into background context for later use. Preserve every distinct fact, theme, definition, and finding, and — critically — preserve every distinct piece of work, task, assignment, or component exactly as separate items, including each one's own word counts, deadlines, weightings, and structure. Never merge, drop, or favour one component over another; if the source describes several separate deliverables, your summary must clearly enumerate all of them. This is background context, not data to compute statistics from.

Source content:
"""
${combined}
"""

Output ONLY the condensed summary as plain text, no markdown headers, no commentary.`;
    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt, temperature: 0 });
    return { summary: text.trim() };
  });

interface ColumnSummary {
  column: string;
  kind: "categorical" | "numeric" | "text";
  counts?: Record<string, number>;
  stats?: { min: number; max: number; avg: number };
  samples?: string[];
}

function summarizeRows(rows: Record<string, unknown>[]): { rowCount: number; columns: ColumnSummary[] } {
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
    const surveySimIds = new Set((simulations ?? []).filter((s: any) => s.survey_id === survey.id).map((s: any) => s.id));
    const surveyResponses = (responses ?? []).filter((r: any) => surveySimIds.has(r.simulation_id));

    const questionSummaries = questions.map((q) => {
      const answers = surveyResponses
        .map((r: any) => (r.answers as any[] | null)?.find((a: any) => a.question_id === q.id)?.answer)
        .filter((a: unknown) => a !== undefined && a !== null && a !== "");
      const distinct = new Set(answers.map(String));
      if (q.options?.length || (distinct.size > 0 && distinct.size <= 15)) {
        const counts: Record<string, number> = {};
        for (const a of answers) counts[String(a)] = (counts[String(a)] ?? 0) + 1;
        return { question: q.text, type: q.type, response_count: answers.length, counts };
      }
      return { question: q.text, type: q.type, response_count: answers.length, sample_answers: answers.slice(0, 15).map(String) };
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
): Promise<{ model: string; prompt: string }> {
  const { DEFAULT_MODEL } = await import("./ai-gateway.server");

  let datasetBlock = "No dataset has been provided yet. If the user asks for analysis, ask them to pick a project or upload a file first.";
  if (data.source.type === "project") {
    const dataset = await buildProjectDataset(supabase, data.source.project_id);
    datasetBlock = `Dataset (survey responses from project "${dataset.project_name}"):\n${JSON.stringify(dataset, null, 2)}`;
  } else if (data.source.type === "file") {
    const summary = summarizeRows(data.source.rows);
    datasetBlock = `Dataset (uploaded file "${data.source.filename}", ${summary.rowCount} rows):\n${JSON.stringify(summary, null, 2)}`;
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
  }

  const instructionsBlock = data.instructions?.trim()
    ? `\n\nADDITIONAL RESEARCHER INSTRUCTIONS (follow these when shaping your analysis and tone):\n${data.instructions.trim()}`
    : "";

  let model = DEFAULT_MODEL;
  let prompt: string;

  const assistantTextAll = data.messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
  const promptAlreadyCreated = /\|\s*:?-{2,}:?\s*\|/.test(assistantTextAll);
  const needsCitations =
    data.instructionsPreset === "chapter4-quant" ||
    data.instructionsPreset === "chapter4-qual" ||
    data.instructionsPreset === "chapter4-mixed" ||
    data.instructionsPreset === "basic-academia" ||
    (data.instructionsPreset === "other-writing" && promptAlreadyCreated);

  let sourcesBlock = "";
  if (needsCitations) {
    const latestUserMessage = [...data.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const topic = [data.background?.slice(0, 600), latestUserMessage, data.instructions].filter(Boolean).join(" — ");
    const { gatherSources, formatSourcePoolBlock } = await import("./research.server");
    const sources = await gatherSources(topic);
    sourcesBlock = formatSourcePoolBlock(sources);
  }

  const sourcesMarkerBlock = sourcesBlock
    ? `\n\nAfter writing the full response, add ONE final line containing ONLY:\n@@SOURCES@@<JSON array of the exact pool entries you actually cited, each shaped {"title":"...","url":"...","authors":["..."],"year":2024}, using titles/URLs copied exactly from the VERIFIED SOURCE POOL above>\nOmit this line entirely if you cited nothing from the pool.`
    : "";

  if (data.instructionsPreset === "other-writing") {
    model = "anthropic/claude-sonnet-4.6";

    if (promptAlreadyCreated) {
      prompt = `You previously created an executable prompt table earlier in this conversation (a structured table defining section breakdown, learning outcomes, word counts, required inputs, formatting standards, non-negotiable constraints, and A+ marking criteria). That table is now the fixed specification for this work — it has already been created and confirmed. Never recreate, restate, regenerate, summarise, preview, or modify that table again for the rest of this conversation, no matter what the user asks next, unless they explicitly ask you to revise the prompt/specification itself.

ABSOLUTE OUTPUT RULE FOR THIS TURN: This response must contain ONLY the requested academic content — the actual section/chapter prose (with its own heading, tables of data/results if the section itself requires one as content, and figures), and nothing else. Specifically forbidden anywhere in this response: any markdown table that restates section breakdowns, word counts, learning outcomes, formatting standards, constraints, or marking criteria; any restatement or paraphrase of the specification; any preamble such as "Here is...", "Based on the prompt...", "I will now write...", or a summary of what you are about to do; any meta-commentary about the table, the task, or your process. Your very first character must be the start of the section's actual heading or opening sentence — go straight into the academic writing itself, exactly as if you were a writer who already has the brief memorised and is simply continuing the document.

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${instructionsBlock}${sourcesBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message by EXECUTING the previously created prompt table: write the actual academic work it specifies — the section, chapter, or full piece the user is now asking for — following every constraint in that table exactly (word counts, formatting, citation style, structure, headings, A+ marking criteria, "write section by section and pause until I say next", etc). Write the real content itself, in full, to the required depth and standard, beginning immediately with the section's heading and prose per the ABSOLUTE OUTPUT RULE above.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON.${sourcesMarkerBlock}`;
    } else {
      const { OTHER_WRITING_TEMPLATE } = await import("./analyze-templates.server");
      prompt = `${OTHER_WRITING_TEMPLATE}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${multiWorkBlock}${instructionsBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies — otherwise produce the executable prompt table as instructed above.

Write your response directly as plain text/markdown prose. Do not wrap it in JSON. Do not add any preamble about what you're about to do — just write the response itself.`;
    }
  } else {
    prompt = `You are a data analyst assistant embedded in a chat interface. You answer questions about the dataset below using only the facts and counts it contains — never invent numbers that aren't derivable from it.

${datasetBlock}${backgroundBlock}${multiWorkBlock}${presetBlock}${instructionsBlock}${sourcesBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies. Otherwise, decide whether a chart and/or table would help illustrate your answer (charts for comparisons/distributions, tables for multi-column breakdowns). Omit them when a plain answer is clearer.

Write your answer directly as plain text, written conversationally. Do not wrap it in JSON.

If a chart would help, end your response with a line containing ONLY:
@@CHART@@{"type":"bar"|"line"|"pie","title":"chart title","data":[{"name":"label","value":0}]}

If a table would help, end your response with a line containing ONLY (after any chart line):
@@TABLE@@{"columns":["Column A","Column B"],"rows":[["value","value"]]}

Omit either marker line entirely when not needed. These marker lines must be the very last lines of your response, valid single-line JSON, and never appear anywhere else in your answer.${sourcesMarkerBlock}`;
  }

  return { model, prompt };
}
