import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GenInput = z.object({
  count: z.number().min(1).max(5000),
  brief: z.string().min(1).max(500),
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

export const generatePersonas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { createAi, DEFAULT_MODEL } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const ai = createAi();

    const aiCount = Math.min(data.count, 50);
    const prompt = `You are generating ${aiCount} diverse synthetic persona profiles for survey research.
Brief from researcher: "${data.brief}"

Output ONLY a valid JSON array (no markdown, no commentary) with exactly ${aiCount} objects matching this shape:
{
  "name": "First Last",
  "age": number (18-85),
  "gender": "male" | "female" | "non-binary",
  "country": "Country",
  "city": "City",
  "education": "high school" | "some college" | "bachelors" | "masters" | "phd" | "trade",
  "income_bracket": "low" | "lower-middle" | "middle" | "upper-middle" | "high",
  "occupation": "concise job title",
  "political_sentiment": "progressive" | "moderate-left" | "centrist" | "moderate-right" | "conservative" | "libertarian" | "apolitical",
  "core_values": ["3-5 concise value words"],
  "language_style": "formal" | "casual" | "academic" | "blunt" | "warm" | "skeptical" | "enthusiastic",
  "bio": "2-3 sentence first-person backstory hinting at lived experience",
  "tags": ["3-5 short demographic/psychographic tags"]
}
Make each persona meaningfully different. Match the brief.`;

    let personas: Array<Record<string, unknown>> = [];
    try {
      const { text } = await generateText({ model: ai(DEFAULT_MODEL), prompt });
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) personas = JSON.parse(jsonMatch[0]);
    } catch {
      personas = [];
    }

    if (personas.length < aiCount) {
      personas = [...personas, ...makeFallbackPersonas(aiCount - personas.length, data.brief, personas.length)];
    }
    if (data.count > aiCount) {
      personas = [...personas, ...makeFallbackPersonas(data.count - aiCount, data.brief, aiCount)];
    }

    const rows = personas.slice(0, data.count).map((p, index) => ({
      user_id: context.userId,
      name: String(p.name ?? `Respondent ${index + 1}`),
      age: typeof p.age === "number" ? p.age : null,
      gender: p.gender ? String(p.gender) : null,
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
  });
