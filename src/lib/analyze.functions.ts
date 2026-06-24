import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100000),
});

const AnalyzeChatInput = z.object({
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
  instructionsPreset: z.enum(["none", "chapter4-quant", "chapter4-qual", "chapter4-mixed", "other-writing"]).default("none"),
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

    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const prompt = `Summarize the following written material (chapters, reports, methodology, notes) into concise bullet points capturing the concrete facts, themes, definitions, and findings that matter for analyzing related data. This is background context, not data to compute statistics from.

Source content:
"""
${combined}
"""

Output ONLY the bullet-point summary as plain text, no markdown headers, no commentary.`;
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

async function buildProjectDataset(supabase: any, projectId: string) {
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

const ChartSpec = z.object({
  type: z.enum(["bar", "line", "pie"]),
  title: z.string(),
  data: z.array(z.object({ name: z.string(), value: z.number() })),
});

const TableSpec = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
});

export const analyzeChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeChatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    let datasetBlock = "No dataset has been provided yet. If the user asks for analysis, ask them to pick a project or upload a file first.";
    if (data.source.type === "project") {
      const dataset = await buildProjectDataset(context.supabase, data.source.project_id);
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
    }

    const instructionsBlock = data.instructions?.trim()
      ? `\n\nADDITIONAL RESEARCHER INSTRUCTIONS (follow these when shaping your analysis and tone):\n${data.instructions.trim()}`
      : "";

    let model = DEFAULT_MODEL;
    let prompt: string;

    if (data.instructionsPreset === "other-writing") {
      const { OTHER_WRITING_TEMPLATE } = await import("./analyze-templates.server");
      model = "anthropic/claude-sonnet-4.6";
      prompt = `${OTHER_WRITING_TEMPLATE}

UPLOADED DOCUMENT CONTEXT${backgroundBlock || "\nNone provided."}${multiWorkBlock}${instructionsBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies — otherwise produce the executable prompt table as instructed above.

Output ONLY valid JSON (no markdown fencing, no commentary) in this exact shape:
{
  "answer": "the role/context/execution paragraphs followed by the full markdown prompt table, as plain text",
  "chart": null,
  "table": null
}`;
    } else {
      prompt = `You are a data analyst assistant embedded in a chat interface. You answer questions about the dataset below using only the facts and counts it contains — never invent numbers that aren't derivable from it.

${datasetBlock}${backgroundBlock}${multiWorkBlock}${presetBlock}${instructionsBlock}

CONVERSATION SO FAR
${history}

Respond to the latest USER message. Follow the MULTI-WORK CHECK above if it applies. Otherwise, decide whether a chart and/or table would help illustrate your answer (charts for comparisons/distributions, tables for multi-column breakdowns). Omit them when a plain answer is clearer.

Output ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "answer": "your analysis in plain text, written conversationally",
  "chart": { "type": "bar" | "line" | "pie", "title": "chart title", "data": [{"name": "label", "value": 0}] } or null,
  "table": { "columns": ["Column A", "Column B"], "rows": [["value", "value"]] } or null
}`;
    }

    const { text } = await generateText({ model: ai(model), prompt, temperature: 0.2, maxOutputTokens: 8000 });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse analysis response");
    let parsed: { answer?: string; chart?: unknown; table?: unknown };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Invalid AI JSON");
    }

    const chart = parsed.chart ? ChartSpec.safeParse(parsed.chart) : null;
    const table = parsed.table ? TableSpec.safeParse(parsed.table) : null;

    return {
      answer: parsed.answer?.trim() || "I couldn't generate an answer for that.",
      chart: chart?.success ? chart.data : null,
      table: table?.success ? table.data : null,
    };
  });
