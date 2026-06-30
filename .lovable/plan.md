## Goal

Turn on Anthropic prompt caching everywhere we hit Claude directly, so the large, repeated prefix of each prompt is billed at ~10% and cache reads are free for ~5 minutes. Today only `api.analyze-stream.ts` uses `cacheControl`; every other Claude call sends the full prompt fresh each time.

## What gets cached (Claude rules)

- Mark the END of the static prefix with `cacheControl: { type: "ephemeral" }`. Everything before the marker is cached; everything after is the per-request tail.
- Minimum cacheable size: 1024 tokens for Sonnet, 2048 for Haiku. Below that, the marker is a no-op (safe), but no point adding it.
- Up to 4 cache breakpoints per request. We'll use one per call site (largest static prefix only).
- Identical bytes required for a hit — any whitespace/template drift inside the cached region kills reuse.

## Call sites to update

1. **`src/routes/api.formatting-stream.ts`** — split `buildFormattingPrompt` into `{ promptCached, promptDynamic }` (system rules / style guide static; user document dynamic) and switch to the same `messages` shape as analyze-stream.
2. **`src/routes/api.formatting-enhance-stream.ts`** — same split for `buildEnhancePrompt`.
3. **`src/routes/api.apply-corrections-stream.ts`** — extract the instruction block (everything from "You are revising…" through "Instructions:" bullets) as cached; keep `DOCUMENT` + `CORRECTIONS TO APPLY` as dynamic tail.
4. **`src/routes/api.presentations-stream.ts`** — apply caching only on the Claude branch (`createCodeExecutionAi`). Update `buildPresentationPrompt` to return `{ promptCached, promptDynamic }` and route the cached branch through `messages`. The gateway/Gemini branch stays as-is (no Anthropic caching there).
5. **`src/lib/interviews.functions.ts`** (3 `generateText` calls) and **`src/lib/analyze.functions.ts`** (1 `generateText` call) — these run through the gateway today (`createAi()`/`textModelForTier()`), so cache_control is provider-specific and only kicks in when the tier resolves to an Anthropic model. Switch the prompts to the same two-part `messages` shape with `providerOptions.anthropic.cacheControl` on the static block; non-Anthropic providers ignore the field, so it's safe.
6. **`src/lib/sandbox-extract.server.ts`** — uses the raw Anthropic SDK directly. Add `cache_control: { type: "ephemeral" }` to the static system/instructions block in the `messages.create` call.
7. **`src/lib/managed-agent.server.ts`** — the Agents/Sessions API caches the agent's `system` and tool/skill definitions automatically per Anthropic's docs, so no code change is needed; verify by reading `usage.cache_read_input_tokens` on a follow-up session event. Document this in a code comment so we don't re-add manual cache markers that would conflict.

## Shared helper

Add `buildCachedMessages(staticPrefix, dynamicTail)` in `src/lib/ai-gateway.server.ts` returning the `messages` array used by analyze-stream, so all five routes use one shape and we don't drift on the `providerOptions` key.

## Verification

- After each route change, hit it twice in quick succession in preview and check the Anthropic response `usage` (logged via `onError`/a small debug log) shows `cache_creation_input_tokens` on call 1 and `cache_read_input_tokens` on call 2.
- Confirm the cached prefix is byte-identical across requests (no `Date.now()`, no user-specific data, no trailing whitespace from template interpolation) — this is the single biggest cause of silent cache misses.

## Out of scope

- Switching gateway-routed calls to direct Anthropic just to enable caching. Where the tier may resolve to Gemini, we leave the call on the gateway and let the cache hint be a no-op.
- 1-hour beta cache TTL — sticking with the default 5-minute ephemeral cache.
