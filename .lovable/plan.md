## Problem

When a user asks for "5,000 teachers in Lagos, Nigeria", the population ends up with Brazilian students, German nurses, etc. Two root causes in `src/lib/personas.functions.ts`:

1. **AI prompt is permissive.** It says "Match the brief" but doesn't bind country/city/occupation as hard constraints, so the model drifts toward global diversity.
2. **Fallback generator ignores the brief.** It rotates through a hardcoded global list (`countries`, `cities`, `jobs`). Because AI generation is capped at 50 (`aiCount = Math.min(data.count, 50)`), any request larger than 50 fills the rest from this off-brief fallback — that's where the Brazilian students come from.

The user's intent: location and role/occupation are **fixed by the brief**. The AI's job is only to vary voice, personality, age, gender, sub-neighborhood/LGA, education, income, values, language style, bio.

## Fix (only `src/lib/personas.functions.ts`)

### 1. Extract constraints from the brief once

Add a small AI call (or rule-based parse fallback) that turns the brief into a structured constraint object:

```ts
{
  country: "Nigeria",
  region: "Lagos State",
  city: "Lagos",
  localities: ["Ikeja", "Surulere", "Yaba", "Lekki", "Ajegunle", ...], // LGAs/districts
  occupation_pool: ["primary school teacher", "secondary school teacher", "private tutor", ...],
  age_range: [22, 65],
  notes: "..."
}
```

If the AI parse fails, fall back to keyword extraction (look for known country names + occupation words) and accept the brief verbatim as the constraint string.

### 2. Tighten the persona-generation prompt

Pass the parsed constraints into the prompt as **hard rules**:

- `country` MUST equal the parsed country for every persona.
- `city` MUST be the parsed city (or one of the listed localities/LGAs) — never another country/city.
- `occupation` MUST be drawn from the occupation pool (or a close variant — e.g. "math teacher, Lagos State Model College").
- Only voice, personality, age, gender, education, income, values, language style, bio, and sub-locality should vary.

### 3. Generate in batches instead of capping at 50

Replace `aiCount = Math.min(data.count, 50)` with a batched loop: request e.g. 25 personas per call, run a few in parallel, repeat until `data.count` is reached. This keeps each prompt small (better adherence) and scales to 5,000 without falling back to junk.

### 4. Rewrite `makeFallbackPersonas` to respect constraints

The fallback is only used if an AI batch fails. It must:

- Always set `country` = parsed country.
- Always pick `city` from the parsed locality list (cycling through them so different LGAs appear).
- Always pick `occupation` from the parsed occupation pool.
- Only vary age, gender, education, income, language style, values, bio.

Delete the hardcoded global `countries`/`cities`/`jobs` rotation entirely — it's the source of the bug.

### 5. Store the parsed constraints on the population row (optional, nice-to-have)

So the same constraints are reused for any future "top-up" generations on that population. Out of scope for this fix unless you want it.

## Files touched

- `src/lib/personas.functions.ts` — only file changed. No schema migration, no UI change.

## What stays the same

- Brief text, population size limits, RLS, table schema, sampling logic, fill flow — all untouched.
- The AI still invents names, ages, bios, personalities, voices, values — just within the locked location + role.
