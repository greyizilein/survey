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
      .select("*", { count: "exact", head: true });
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

const BATCH_SIZE = 50;
const MAX_CONCURRENT_BATCHES = 10;

function buildPersonaPrompt(count: number, brief: string, batchIndex: number): string {
  return `You are generating ${count} synthetic persona profiles for a survey research population.

POPULATION BRIEF: "${brief}"

STRICT RULES — violating any of these is an error:
• country and city MUST reflect the location stated in the brief — do NOT place any persona in a different country or city
• occupation MUST reflect the role or group stated in the brief — do NOT use unrelated jobs or roles
• Diversity should come ONLY from: age, gender, education level, income bracket, political views, personality, values, and biography
• Names must be culturally appropriate for the location in the brief
• This is batch ${batchIndex + 1} — make sure names and bios are distinct from other batches

Output ONLY a valid JSON array (no markdown, no commentary) with exactly ${count} objects:
[{
  "name": "First Last",
  "age": <18-85>,
  "gender": "male" | "female",
  "country": "<country from the brief>",
  "city": "<city from the brief, or nearest major city if not specified>",
  "education": "high school" | "some college" | "bachelors" | "masters" | "phd" | "trade",
  "income_bracket": "low" | "lower-middle" | "middle" | "upper-middle" | "high",
  "occupation": "<specific role matching the brief>",
  "political_sentiment": "progressive" | "moderate-left" | "centrist" | "moderate-right" | "conservative" | "libertarian" | "apolitical",
  "core_values": ["3-5 concise value words"],
  "language_style": "formal" | "casual" | "academic" | "blunt" | "warm" | "skeptical" | "enthusiastic",
  "bio": "2-3 sentence first-person backstory grounded in the specific location and role from the brief",
  "tags": ["3-5 demographic/psychographic tags relevant to the brief"]
}]`;
}

async function generatePersonasInternal(
  context: { userId: string; supabase: any },
  data: { count: number; brief: string; population_id?: string },
) {
  {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const totalBatches = Math.ceil(data.count / BATCH_SIZE);

    async function runBatch(batchIndex: number): Promise<Array<Record<string, unknown>>> {
      const batchSize = Math.min(BATCH_SIZE, data.count - batchIndex * BATCH_SIZE);
      const prompt = buildPersonaPrompt(batchSize, data.brief, batchIndex);
      try {
        const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, batchSize);
        }
      } catch {}
      return makeFallbackPersonas(batchSize, data.brief, batchIndex * BATCH_SIZE);
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

    const rows = allPersonas.slice(0, data.count).map((p, index) => ({
      user_id: context.userId,
      population_id: data.population_id ?? null,
      name: String(p.name ?? `Respondent ${index + 1}`),
      age: typeof p.age === "number" ? p.age : null,
      gender: normalizeGender(p.gender),
      country: p.country ? String(p.country) : null,
      city: p.city ? String(p.city) : null,
      education: p.education ? String(p.education) : null,
      income_bracket: p.income_bracket ? String(p.income_bracket) : null,
      occupation: p.occupation ? String(p.occupation) : null,
      political_sentiment: p.political_sentiment ? String(p.political_sentiment) : null,
      core_values: Array.isArray(p.core_values) ? p.core_values.map(String) : null,
      language_style: p.language_style ? String(p.language_style) : null,
      bio: p.bio ? String(p.bio) : null,
      tags: Array.isArray(p.tags) ? p.tags.map(String) : null,
    }));

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

function parseBriefHints(brief: string): { city: string; country: string; occupation: string } {
  // Match "in [City], [Country]" or "in [Location]"
  const inMatch = brief.match(/\bin\s+([\w\s\-]+?)(?:,\s*([\w\s\-]+?))?(?:\s*(?:district|lga|area|region|province|state)\b|\s*$|[.!?,])/i);
  // Match the role/group before "in" / "from" / "of"
  const roleMatch = brief.match(/^([\w\s\-']+?)\s+(?:in|from|of|across)\s+/i);

  const loc1 = inMatch?.[1]?.trim() ?? "";
  const loc2 = inMatch?.[2]?.trim() ?? "";

  return {
    city: loc1 || "the location in the brief",
    country: loc2 || loc1 || "the country in the brief",
    occupation: roleMatch?.[1]?.trim() || "professional",
  };
}

function makeFallbackPersonas(count: number, brief: string, offset = 0): Array<Record<string, unknown>> {
  const { city, country, occupation } = parseBriefHints(brief);
  const education = ["high school", "some college", "bachelors", "masters", "trade", "phd"];
  const sentiments = ["progressive", "moderate-left", "centrist", "moderate-right", "conservative", "libertarian", "apolitical"];
  const styles = ["formal", "casual", "academic", "blunt", "warm", "skeptical", "enthusiastic"];
  const values = ["security", "family", "autonomy", "fairness", "tradition", "opportunity", "stability", "community", "privacy", "ambition"];
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    return {
      name: `Respondent ${n + 1}`,
      age: 18 + (n * 7) % 67,
      gender: ["female", "male"][n % 2],
      country,
      city,
      education: education[n % education.length],
      income_bracket: ["low", "lower-middle", "middle", "upper-middle", "high"][n % 5],
      occupation,
      political_sentiment: sentiments[n % sentiments.length],
      core_values: [values[n % values.length], values[(n + 3) % values.length], values[(n + 6) % values.length]],
      language_style: styles[n % styles.length],
      bio: `I am a ${occupation} based in ${city}, ${country}. My perspective is shaped by my local context and professional experience.`,
      tags: [country, occupation, education[n % education.length], sentiments[n % sentiments.length]],
    };
  });
}
