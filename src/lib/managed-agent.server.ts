import { createRawAnthropic } from "./ai-gateway.server";

const AGENT_NAME = "Survey App Assistant";
const ENVIRONMENT_NAME = "survey-app-sandbox";

const AGENT_SYSTEM_PROMPT = `You are the Survey App Assistant, a general-purpose agent embedded in a research/insights platform. You can do everything the app's own tools do, end to end in one conversation:
- Data analysis: compute real statistics from data the user gives you or pastes in, using Python (pandas/numpy/scipy/statsmodels) via your bash tool. Never estimate a number you can compute exactly.
- Academic/business writing: you have a dedicated skill for each document type (dissertations, standalone Chapter Fours, basic academic writing, advanced/general writing) — always check whether one of your writing skills matches the work before improvising your own structure, and follow its intake protocol and structure exactly, including asking the user for any details it says to ask for.
- Presentations: design slide decks and, when the user wants an actual file, generate a real .pptx using the pptx skill. Use the xlsx skill for real spreadsheets and the docx skill for real Word documents when the user wants a downloadable file rather than just chat output.
- Charts and figures: when useful, generate real matplotlib charts and save them as files the user can download.
- Research and citations: use your web_search/web_fetch tools to find and verify any real-world facts, statistics, or sources you cite — never invent a source.
- Memory: you have a per-user memory store mounted as a directory — check it at the start of a conversation for relevant context from past sessions, and write durable preferences or project details there as you learn them.

You explicitly do NOT handle survey design/distribution or interview transcription/analysis — if asked for those, tell the user to use the app's dedicated Surveys or Interviews tools instead.

Be direct and concrete. Prefer actually running code/searches over guessing.

DELIVERABLE FILES: any file you want the user to be able to download (charts, .pptx/.xlsx/.docx/.pdf, images, anything produced via bash or a skill) MUST be written to (or copied to) the \`/mnt/session/outputs/\` directory — that is the ONLY location the app can retrieve files from. A file saved anywhere else (e.g. just \`/workspace/\`) is invisible to the user no matter what you say about it. When you produce such a file, say so clearly and name it, and confirm it's in \`/mnt/session/outputs/\`.

WORD COUNT DISCIPLINE (writing tasks): If a word count (total or per-section) is specified anywhere — the user's message, earlier conversation, an uploaded brief/rubric, or a writing skill's per-section breakdown — treat it as a hard ceiling, not a suggestion. Allocate the count across sections before writing, and keep a running tally as you draft so no section silently runs long. Aim to land within about 10% of the requested count by writing tighter and denser, never by cutting a section short — every section you start must be finished in full. The finished document must contain ONLY the actual requested content; never insert a note, caveat, or meta-commentary about word counts or length into the document itself. If the requested depth genuinely cannot fit the stated count, mention that as ordinary chat conversation before or after the piece, outside the document text, and still deliver the full piece.

Never use emojis anywhere in your responses or generated documents, under any circumstances, unless the user explicitly asks you to include them.`;

const WRITING_SKILLS: Array<{ id: string; title: string; description: string; template: () => Promise<string> }> = [
  {
    id: "dissertation-writer",
    title: "Dissertation Writer",
    description:
      "Use this skill whenever the user wants a full empirical dissertation or thesis (Abstract through Chapters One-Five). Triggers include: 'dissertation', 'thesis', requests for a complete academic study with chapters, or a brief/rubric describing a full multi-chapter research project. Do NOT use for a single chapter in isolation (use the matching Chapter Four skill instead) or for non-academic writing.",
    template: async () => (await import("./analyze-templates.server")).DISSERTATION_WRITER_TEMPLATE,
  },
  {
    id: "chapter-four-quant",
    title: "Chapter Four — Quantitative",
    description:
      "Use this skill when the user wants a standalone Chapter Four / Results / Findings chapter for a quantitative study (surveys with numeric analysis, statistical tests, regressions). Triggers include: 'chapter 4', 'results chapter', 'findings chapter' paired with mentions of quantitative data, statistics, or numeric survey results. Do NOT use for qualitative or mixed-methods chapters, or full dissertations.",
    template: async () => (await import("./analyze-templates.server")).QUANT_CHAPTER_FOUR_TEMPLATE,
  },
  {
    id: "chapter-four-qual",
    title: "Chapter Four — Qualitative",
    description:
      "Use this skill when the user wants a standalone Chapter Four / Results / Findings chapter for a qualitative study (interviews, thematic analysis, case studies). Triggers include: 'chapter 4', 'results chapter', 'findings chapter' paired with mentions of qualitative data, themes, or interview/case-study analysis. Do NOT use for quantitative or mixed-methods chapters, or full dissertations.",
    template: async () => (await import("./analyze-templates.server")).QUAL_CHAPTER_FOUR_TEMPLATE,
  },
  {
    id: "chapter-four-mixed",
    title: "Chapter Four — Mixed Methods",
    description:
      "Use this skill when the user wants a standalone Chapter Four / Results / Findings chapter for a mixed-methods study combining quantitative and qualitative data. Triggers include: 'chapter 4', 'results chapter', 'findings chapter' paired with mentions of mixed methods, or both numeric and interview/qualitative data together. Do NOT use for single-method chapters, or full dissertations.",
    template: async () => (await import("./analyze-templates.server")).MIXED_CHAPTER_FOUR_TEMPLATE,
  },
  {
    id: "basic-academic-writing",
    title: "Basic Academic Writing",
    description:
      "Use this skill for shorter, simpler academic assignments: essays, case study write-ups, short reports, coursework, reflections, or any academic task that is NOT a full dissertation or a dissertation chapter. Triggers include school/university assignments with a rubric or brief but no multi-chapter structure. Do NOT use for full dissertations, Chapter Fours, or non-academic business writing.",
    template: async () => (await import("./analyze-templates.server")).BASIC_ACADEMIA_TEMPLATE,
  },
  {
    id: "advanced-writing",
    title: "Advanced Writing",
    description:
      "Use this skill for any other substantial piece of writing that isn't covered by the dissertation/chapter/basic-academic skills: business reports, briefs, proposals, articles, white papers, or any academic writing whose structure should be derived from an uploaded brief/rubric rather than a fixed template. Builds the right structure and depth dynamically from the brief and chat context. Do NOT use for full dissertations, Chapter Fours, or short basic academic assignments — prefer those more specific skills when they match.",
    template: async () => (await import("./analyze-templates.server")).OTHER_WRITING_TEMPLATE,
  },
];

async function findExisting<T extends { name: string }>(
  list: AsyncIterable<T>,
  name: string,
): Promise<T | null> {
  for await (const item of list) {
    if (item.name === name) return item;
  }
  return null;
}

type McpServerConfig = { name: string; url: string };

function getConfiguredMcpServers(): McpServerConfig[] {
  const raw = process.env.MANAGED_AGENT_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is McpServerConfig => typeof s?.name === "string" && typeof s?.url === "string");
  } catch {
    console.error("[managed-agent] MANAGED_AGENT_MCP_SERVERS is not valid JSON; ignoring.");
    return [];
  }
}

function getConfiguredVaultIds(): string[] {
  const raw = process.env.MANAGED_AGENT_VAULT_IDS;
  if (!raw) return [];
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

async function findCustomSkillByTitle(
  client: Awaited<ReturnType<typeof createRawAnthropic>>,
  title: string,
): Promise<string | null> {
  for await (const skill of client.beta.skills.list({ source: "custom" })) {
    if (skill.display_title === title) return skill.id;
  }
  return null;
}

function buildSkillMarkdown(name: string, description: string, body: string): string {
  const escapedDescription = description.replace(/"/g, '\\"');
  return `---\nname: ${name}\ndescription: "${escapedDescription}"\n---\n\n${body}\n`;
}

async function getOrCreateWritingSkillId(
  client: Awaited<ReturnType<typeof createRawAnthropic>>,
  spec: (typeof WRITING_SKILLS)[number],
): Promise<string> {
  const existing = await findCustomSkillByTitle(client, spec.title);
  if (existing) return existing;

  const { toFile } = await import("@anthropic-ai/sdk");
  const body = await spec.template();
  const markdown = buildSkillMarkdown(spec.id, spec.description, body);
  const skill = await client.beta.skills.create({
    display_title: spec.title,
    files: [await toFile(Buffer.from(markdown, "utf-8"), `${spec.id}/SKILL.md`, { type: "text/markdown" })],
  });
  return skill.id;
}

export async function getOrCreateAgentId(): Promise<string> {
  const client = await createRawAnthropic();

  const writingSkillIds = await Promise.all(WRITING_SKILLS.map((spec) => getOrCreateWritingSkillId(client, spec)));
  const skills = [
    { type: "anthropic" as const, skill_id: "pptx" },
    { type: "anthropic" as const, skill_id: "xlsx" },
    { type: "anthropic" as const, skill_id: "docx" },
    { type: "anthropic" as const, skill_id: "pdf" },
    ...writingSkillIds.map((skill_id) => ({ type: "custom" as const, skill_id })),
  ];
  const mcpServers = getConfiguredMcpServers();
  const tools = [
    {
      type: "agent_toolset_20260401" as const,
      default_config: { enabled: true, permission_policy: { type: "always_allow" as const } },
    },
    ...mcpServers.map((s) => ({ type: "mcp_toolset" as const, mcp_server_name: s.name })),
  ];

  const existing = await findExisting(client.beta.agents.list(), AGENT_NAME);
  if (existing) {
    const updated = await client.beta.agents.update(existing.id, {
      version: existing.version,
      system: AGENT_SYSTEM_PROMPT,
      tools,
      skills,
      mcp_servers: mcpServers.map((s) => ({ type: "url" as const, name: s.name, url: s.url })),
    });
    return updated.id;
  }

  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: "claude-sonnet-4-6",
    system: AGENT_SYSTEM_PROMPT,
    tools,
    skills,
    mcp_servers: mcpServers.map((s) => ({ type: "url" as const, name: s.name, url: s.url })),
  });
  return agent.id;
}

const USER_MEMORY_STORE_PREFIX = "user-memory-";

async function getOrCreateUserMemoryStoreId(
  client: Awaited<ReturnType<typeof createRawAnthropic>>,
  userId: string,
): Promise<string> {
  const name = `${USER_MEMORY_STORE_PREFIX}${userId}`;
  const existing = await findExisting(client.beta.memoryStores.list(), name);
  if (existing) return existing.id;

  const store = await client.beta.memoryStores.create({
    name,
    description:
      "Notes the agent has saved about this specific user across past sessions — their projects, preferences, and any context worth remembering. Check it before starting work and update it when you learn something durable.",
  });
  return store.id;
}

export async function getOrCreateEnvironmentId(): Promise<string> {
  const client = await createRawAnthropic();
  const existing = await findExisting(client.beta.environments.list(), ENVIRONMENT_NAME);
  if (existing) return existing.id;

  const environment = await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
      packages: { pip: ["pandas", "numpy", "scipy", "statsmodels", "matplotlib", "openpyxl", "python-pptx", "python-docx"] },
    },
  });
  return environment.id;
}

export async function createAgentSession(userId: string): Promise<string> {
  const client = await createRawAnthropic();
  const [agentId, environmentId, memoryStoreId] = await Promise.all([
    getOrCreateAgentId(),
    getOrCreateEnvironmentId(),
    getOrCreateUserMemoryStoreId(client, userId),
  ]);
  const vaultIds = getConfiguredVaultIds();

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: "read_write",
        instructions: "Per-user memory from past sessions with this person. Check before starting any task; save durable preferences or project context here as you learn them.",
      },
    ],
    ...(vaultIds.length > 0 ? { vault_ids: vaultIds } : {}),
  });
  return session.id;
}

export type AgentStreamChunk =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "file"; fileId: string; filename?: string; mediaType?: string }
  | { type: "done" }
  | { type: "error"; text: string };

export async function* streamAgentTurn(sessionId: string, message: string): AsyncGenerator<AgentStreamChunk> {
  const client = await createRawAnthropic();

  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: message }] }],
  });

  const stream = await client.beta.sessions.events.stream(sessionId);
  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text" && block.text) yield { type: "text", text: block.text };
      }
    } else if (event.type === "agent.tool_use") {
      yield { type: "status", text: `\n_using ${event.name}…_\n` };
    } else if (event.type === "session.error") {
      yield { type: "error", text: event.error.message ?? "The agent hit an error." };
    } else if (event.type === "session.status_idle" || event.type === "session.status_terminated") {
      for (const f of await listNewOutputFiles(client, sessionId)) {
        yield { type: "file", fileId: f.id, filename: f.filename, mediaType: f.mime_type };
      }
      yield { type: "done" };
      break;
    }
  }
}

const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01" as const;
const knownSessionOutputFiles = new Map<string, Set<string>>();

async function listNewOutputFiles(
  client: Awaited<ReturnType<typeof createRawAnthropic>>,
  sessionId: string,
): Promise<Array<{ id: string; filename: string; mime_type: string }>> {
  const seen = knownSessionOutputFiles.get(sessionId) ?? new Set<string>();
  let fresh: Array<{ id: string; filename: string; mime_type: string }> = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    fresh = [];
    for await (const f of client.beta.files.list({ scope_id: sessionId, betas: [MANAGED_AGENTS_BETA] })) {
      if (!seen.has(f.id)) fresh.push(f);
    }
    if (fresh.length > 0) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  for (const f of fresh) seen.add(f.id);
  knownSessionOutputFiles.set(sessionId, seen);
  return fresh;
}

export async function downloadAgentFile(fileId: string): Promise<{ base64: string; mediaType: string; filename: string }> {
  const client = await createRawAnthropic();
  const [metadata, response] = await Promise.all([
    client.beta.files.retrieveMetadata(fileId),
    client.beta.files.download(fileId),
  ]);
  const buf = Buffer.from(await response.arrayBuffer());
  return { base64: buf.toString("base64"), mediaType: metadata.mime_type, filename: metadata.filename };
}
