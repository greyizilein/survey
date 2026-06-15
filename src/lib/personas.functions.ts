import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GenInput = z.object({
  count: z.number().min(1).max(5000),
  brief: z.string().min(1).max(500),
  population_id: z.string().uuid().optional(),
});

export const listPersonas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("personas")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const countPersonas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("personas")
      .select("*", { count: "exact", head: true })
      .eq("user_id", context.userId);
    return count ?? 0;
  });

export const deletePersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("personas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CreatePopulationInput = z.object({
  name: z.string().min(1).max(120),
  brief: z.string().min(1).max(500),
  size: z.number().min(1).max(5000),
});

export const listPopulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("populations")
      .select("*, personas(count)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((p: any) => ({
      ...p,
      persona_count: p.personas?.[0]?.count ?? 0,
      personas: undefined,
    }));
  });

export const deletePopulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("populations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Create a named population, then generate `size` personas into it.
export const createPopulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreatePopulationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: population, error } = await context.supabase
      .from("populations")
      .insert({ user_id: context.userId, name: data.name, brief: data.brief, target_size: data.size })
      .select()
      .single();
    if (error || !population) throw new Error(error?.message ?? "Could not create population");

    const result = await generatePersonasInternal(context, { count: data.size, brief: data.brief, population_id: population.id });
    return { population, inserted: result.inserted };
  });

export const generatePersonas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => generatePersonasInternal(context, data));

interface BriefConstraints {
  country: string | null;
  region: string | null;
  city: string | null;
  localities: string[];
  occupation_pool: string[];
  age_range: [number, number];
  notes: string;
}

async function parseBriefConstraints(brief: string): Promise<BriefConstraints> {
  const empty: BriefConstraints = {
    country: null,
    region: null,
    city: null,
    localities: [],
    occupation_pool: [],
    age_range: [18, 75],
    notes: brief,
  };
  try {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();
    const prompt = `You are extracting hard sampling constraints from a researcher's population brief. The location and occupation/role described in the brief are FIXED — they must apply to every persona generated. Only voice, personality, age, gender, education, income, values, language style, and exact neighborhood may vary.

Brief: "${brief}"

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "country": "Country name in English, or null if the brief is location-agnostic",
  "region": "State/province/region if implied or stated, else null",
  "city": "Primary city if implied or stated, else null",
  "localities": ["8-15 real neighborhoods, districts, LGAs, suburbs, or towns inside the region/city above. Must be real places. Empty array if no location."],
  "occupation_pool": ["6-12 specific real-world occupation variants that fit the brief's role (e.g. for 'teachers in Lagos': 'primary school teacher', 'secondary school maths teacher', 'private tutor', 'NYSC teaching corps member', 'school headmistress'). Empty array if the brief does not name a role."],
  "age_range": [min_age, max_age] reasonable for the described population,
  "notes": "Anything else hard-constrained by the brief (income band, language, religion, employer type, etc). Free text."
}`;
    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    const parsed = JSON.parse(match[0]);
    return {
      country: parsed.country ? String(parsed.country) : null,
      region: parsed.region ? String(parsed.region) : null,
      city: parsed.city ? String(parsed.city) : null,
      localities: Array.isArray(parsed.localities) ? parsed.localities.map(String).filter(Boolean) : [],
      occupation_pool: Array.isArray(parsed.occupation_pool) ? parsed.occupation_pool.map(String).filter(Boolean) : [],
      age_range: Array.isArray(parsed.age_range) && parsed.age_range.length === 2
        ? [Number(parsed.age_range[0]) || 18, Number(parsed.age_range[1]) || 75]
        : [18, 75],
      notes: parsed.notes ? String(parsed.notes) : brief,
    };
  } catch {
    return empty;
  }
}

function constraintRulesText(c: BriefConstraints): string {
  const lines: string[] = [];
  if (c.country) lines.push(`- country MUST be exactly "${c.country}" for every persona. Never use any other country.`);
  if (c.region) lines.push(`- region/state context: "${c.region}".`);
  if (c.city) {
    if (c.localities.length) {
      lines.push(`- city MUST be "${c.city}" OR one of these real neighborhoods/LGAs inside it: ${c.localities.join(", ")}. Vary the neighborhood across personas.`);
    } else {
      lines.push(`- city MUST be "${c.city}".`);
    }
  } else if (c.localities.length) {
    lines.push(`- city MUST be one of: ${c.localities.join(", ")}.`);
  }
  if (c.occupation_pool.length) {
    lines.push(`- occupation MUST be drawn from (or a close, realistic variant of) this role pool: ${c.occupation_pool.join("; ")}. Do not invent unrelated jobs.`);
  }
  lines.push(`- age MUST fall within ${c.age_range[0]}-${c.age_range[1]}.`);
  if (c.notes && c.notes.trim()) lines.push(`- Additional constraint from brief: ${c.notes.trim()}`);
  if (!lines.length) lines.push(`- Match the brief: "${c.notes || ""}"`);
  return lines.join("\n");
}

const BATCH_SIZE = 50;
const MAX_CONCURRENT_BATCHES = 10;

async function generateBatch(
  brief: string,
  constraints: BriefConstraints,
  size: number,
  seedIndex: number,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();
    const prompt = `Generate ${size} synthetic survey personas for this research brief.

Brief: "${brief}"

HARD CONSTRAINTS (must be true for every persona — do not drift):
${constraintRulesText(constraints)}

What you SHOULD vary: first/last names, exact age (within range), gender, education, income bracket, political sentiment, core values, language style, personality, life situation, and exact neighborhood (from the allowed list).

Output ONLY a valid JSON array (no markdown, no commentary) with exactly ${size} objects:
[{
  "name": "First Last (culturally appropriate for the location)",
  "age": <number within the allowed range>,
  "gender": "male" | "female",
  "country": "<must equal the constrained country exactly>",
  "city": "<the constrained city or one of the allowed neighborhoods>",
  "education": "high school" | "some college" | "bachelors" | "masters" | "phd" | "trade",
  "income_bracket": "low" | "lower-middle" | "middle" | "upper-middle" | "high",
  "occupation": "<must come from the allowed role pool>",
  "political_sentiment": "progressive" | "moderate-left" | "centrist" | "moderate-right" | "conservative" | "libertarian" | "apolitical",
  "core_values": ["3-5 concise value words"],
  "language_style": "formal" | "casual" | "academic" | "blunt" | "warm" | "skeptical" | "enthusiastic",
  "bio": "3-4 sentence first-person backstory grounded in their specific neighborhood, school/workplace, daily commute, and role",
  "life_situation": "One concrete sentence: their specific workplace, daily constraints, family context (e.g. 'Teaches 58 students in a public primary school in Mushin, commutes 75 min by danfo, supports two younger siblings')",
  "key_concerns": ["2-3 specific things this person actively worries about in their daily life and work"],
  "voice_sample": "One sentence written exactly how this person would speak — showing their vocabulary, register, and whether they use local phrases or pidgin",
  "tags": ["3-5 short demographic/psychographic tags"]
}]
Batch seed: ${seedIndex} (use it to ensure names and bios are distinct from prior batches).`;
    const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Generate `count` brief-correct persona rows (not yet inserted). Every row is
// forced to match the parsed location/occupation constraints so the sample
// never drifts off-brief (e.g. into other countries or unrelated jobs).
export async function buildPersonaRows(
  userId: string,
  count: number,
  brief: string,
  populationId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const constraints = await parseBriefConstraints(brief);
  const totalBatches = Math.ceil(count / BATCH_SIZE);

  async function runBatch(batchIndex: number): Promise<Array<Record<string, unknown>>> {
    const batchSize = Math.min(BATCH_SIZE, count - batchIndex * BATCH_SIZE);
    const result = await generateBatch(brief, constraints, batchSize, batchIndex);
    if (result.length < batchSize) {
      return [
        ...result,
        ...makeFallbackPersonas(batchSize - result.length, brief, constraints, batchIndex * BATCH_SIZE + result.length),
      ];
    }
    return result;
  }

  // Run batches in parallel, capped at MAX_CONCURRENT_BATCHES at a time
  const allPersonas: Array<Record<string, unknown>> = [];
  for (let i = 0; i < totalBatches; i += MAX_CONCURRENT_BATCHES) {
    const chunk = Array.from(
      { length: Math.min(MAX_CONCURRENT_BATCHES, totalBatches - i) },
      (_, j) => runBatch(i + j),
    );
    const results = await Promise.all(chunk);
    allPersonas.push(...results.flat());
  }

  // Enforce constraints on every row (catches any AI drift) before insert.
  const allowedCities = constraints.city
    ? [constraints.city, ...constraints.localities]
    : constraints.localities;
  const [minAge, maxAge] = constraints.age_range;

  return allPersonas.slice(0, count).map((p, index) => {
    const country = constraints.country ?? (p.country ? String(p.country) : null);
    let city: string | null = p.city ? String(p.city) : null;
    if (allowedCities.length) {
      const match = allowedCities.find((c) => city && c.toLowerCase() === city!.toLowerCase());
      city = match ?? allowedCities[index % allowedCities.length];
    }
    let occupation: string | null = p.occupation ? String(p.occupation) : null;
    if (constraints.occupation_pool.length) {
      const inPool = constraints.occupation_pool.some(
        (o) => occupation && o.toLowerCase() === occupation!.toLowerCase(),
      );
      if (!inPool) occupation = constraints.occupation_pool[index % constraints.occupation_pool.length];
    }
    let age = typeof p.age === "number" ? p.age : minAge + (index % Math.max(1, maxAge - minAge));
    if (age < minAge) age = minAge;
    if (age > maxAge) age = maxAge;

    return {
      user_id: userId,
      population_id: populationId,
      name: String(p.name ?? `Respondent ${index + 1}`),
      age,
      gender: normalizeGender(p.gender),
      country,
      city,
      education: p.education ? String(p.education) : null,
      income_bracket: p.income_bracket ? String(p.income_bracket) : null,
      occupation,
      political_sentiment: p.political_sentiment ? String(p.political_sentiment) : null,
      core_values: Array.isArray(p.core_values) ? p.core_values.map(String) : null,
      language_style: p.language_style ? String(p.language_style) : null,
      bio: p.bio ? String(p.bio) : null,
      life_situation: p.life_situation ? String(p.life_situation) : null,
      key_concerns: Array.isArray(p.key_concerns) ? p.key_concerns.map(String) : null,
      voice_sample: p.voice_sample ? String(p.voice_sample) : null,
      tags: Array.isArray(p.tags) ? p.tags.map(String) : null,
    };
  });
}

async function generatePersonasInternal(
  context: { userId: string; supabase: any },
  data: { count: number; brief: string; population_id?: string },
) {
  const rows = await buildPersonaRows(context.userId, data.count, data.brief, data.population_id ?? null);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error, count } = await context.supabase
      .from("personas")
      .insert(rows.slice(i, i + 500), { count: "exact" });
    if (error) throw new Error(error.message);
    inserted += count ?? rows.slice(i, i + 500).length;
  }
  return { inserted };
}

// Generate fresh, brief-correct personas for a one-off fill run and return the
// inserted records (with ids) so responses can reference them.
export async function generatePersonasForFill(
  supabase: any,
  userId: string,
  count: number,
  brief: string,
): Promise<any[]> {
  const rows = await buildPersonaRows(userId, count, brief, null);
  const { data: inserted, error } = await supabase.from("personas").insert(rows).select("*");
  if (error) throw new Error(error.message);
  return inserted ?? [];
}

// Draw `count` personas from a population. "stratified" balances the sample
// evenly across gender and country combinations present in the population.
export async function samplePersonas(
  supabase: any,
  populationId: string,
  count: number,
  method: "random" | "stratified" = "random",
) {
  const { data: all, error } = await supabase
    .from("personas")
    .select("*")
    .eq("population_id", populationId);
  if (error) throw new Error(error.message);
  const pool: any[] = all ?? [];
  if (!pool.length) return [];

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  if (method === "random" || pool.length <= count) {
    return shuffled.slice(0, count);
  }

  // Stratified: group by gender+country, then take proportionally from each group.
  const groups = new Map<string, any[]>();
  for (const persona of shuffled) {
    const key = `${persona.gender ?? "unknown"}::${persona.country ?? "unknown"}`;
    const group = groups.get(key) ?? [];
    group.push(persona);
    groups.set(key, group);
  }
  const groupKeys = [...groups.keys()];
  const sample: any[] = [];
  let i = 0;
  while (sample.length < count && sample.length < pool.length) {
    const key = groupKeys[i % groupKeys.length];
    const group = groups.get(key)!;
    if (group.length) sample.push(group.shift());
    i++;
  }
  return sample;
}

function normalizeGender(value: unknown): "male" | "female" {
  const s = String(value ?? "").toLowerCase();
  return s.startsWith("f") ? "female" : "male";
}

// Fallback used ONLY if an AI batch fails. Stays inside the parsed constraints —
// never invents off-brief countries or occupations.
function makeFallbackPersonas(
  count: number,
  brief: string,
  c: BriefConstraints,
  offset = 0,
): Array<Record<string, unknown>> {
  const education = ["high school", "some college", "bachelors", "masters", "trade", "phd"];
  const sentiments = ["progressive", "moderate-left", "centrist", "moderate-right", "conservative", "libertarian", "apolitical"];
  const styles = ["formal", "casual", "academic", "blunt", "warm", "skeptical", "enthusiastic"];
  const values = ["security", "family", "autonomy", "fairness", "tradition", "opportunity", "stability", "community", "privacy", "ambition"];
  const cityPool = c.city ? [c.city, ...c.localities] : (c.localities.length ? c.localities : ["—"]);
  const jobPool = c.occupation_pool.length ? c.occupation_pool : ["respondent"];
  const [minAge, maxAge] = c.age_range;
  const span = Math.max(1, maxAge - minAge);
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    const city = cityPool[n % cityPool.length];
    const job = jobPool[n % jobPool.length];
    return {
      name: `Respondent ${n + 1}`,
      age: minAge + (n * 7) % span,
      gender: ["female", "male"][n % 2],
      country: c.country ?? null,
      city,
      education: education[n % education.length],
      income_bracket: ["low", "lower-middle", "middle", "upper-middle", "high"][n % 5],
      occupation: job,
      political_sentiment: sentiments[n % sentiments.length],
      core_values: [values[n % values.length], values[(n + 3) % values.length], values[(n + 6) % values.length]],
      language_style: styles[n % styles.length],
      bio: `I bring the perspective of a ${job} in ${city}${c.country ? ", " + c.country : ""}, shaped by ${brief.toLowerCase().slice(0, 120)}.`,
      life_situation: `Works as a ${job} in ${city}.`,
      key_concerns: [values[n % values.length], values[(n + 2) % values.length]],
      voice_sample: null,
      tags: [c.country, city, job].filter(Boolean) as string[],
    };
  });
}
