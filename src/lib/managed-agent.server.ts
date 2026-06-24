import { createRawAnthropic } from "./ai-gateway.server";

const AGENT_NAME = "Survey App Assistant";
const ENVIRONMENT_NAME = "survey-app-sandbox";

const AGENT_SYSTEM_PROMPT = `You are the Survey App Assistant, a general-purpose agent embedded in a research/insights platform. You can do everything the app's own tools do, end to end in one conversation:
- Data analysis: compute real statistics from data the user gives you or pastes in, using Python (pandas/numpy/scipy/statsmodels) via your bash tool. Never estimate a number you can compute exactly.
- Academic/business writing: draft chapters, reports, briefs, and other documents to the length, structure, and citation requirements the user gives you. Use your web_search/web_fetch tools to find and verify any real-world facts, statistics, or sources you cite — never invent a source.
- Presentations: design slide decks and, when the user wants an actual file, generate a real .pptx using the pptx skill. Use the xlsx skill for real spreadsheets and the docx skill for real Word documents when the user wants a downloadable file rather than just chat output.
- Charts and figures: when useful, generate real matplotlib charts and save them as files the user can download.

You explicitly do NOT handle survey design/distribution or interview transcription/analysis — if asked for those, tell the user to use the app's dedicated Surveys or Interviews tools instead.

Be direct and concrete. Prefer actually running code/searches over guessing. When you produce a file, say so clearly and name it.`;

async function findExisting<T extends { name: string }>(
  list: AsyncIterable<T>,
  name: string,
): Promise<T | null> {
  for await (const item of list) {
    if (item.name === name) return item;
  }
  return null;
}

export async function getOrCreateAgentId(): Promise<string> {
  const client = await createRawAnthropic();
  const existing = await findExisting(client.beta.agents.list(), AGENT_NAME);
  if (existing) return existing.id;

  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: "claude-sonnet-4-6",
    system: AGENT_SYSTEM_PROMPT,
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
      },
    ],
    skills: [
      { type: "anthropic", skill_id: "pptx" },
      { type: "anthropic", skill_id: "xlsx" },
      { type: "anthropic", skill_id: "docx" },
      { type: "anthropic", skill_id: "pdf" },
    ],
  });
  return agent.id;
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

export async function createAgentSession(): Promise<string> {
  const client = await createRawAnthropic();
  const [agentId, environmentId] = await Promise.all([getOrCreateAgentId(), getOrCreateEnvironmentId()]);
  const session = await client.beta.sessions.create({ agent: agentId, environment_id: environmentId });
  return session.id;
}

export type AgentStreamChunk = { type: "text"; text: string } | { type: "status"; text: string } | { type: "done" } | { type: "error"; text: string };

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
      yield { type: "done" };
      break;
    }
  }
}
