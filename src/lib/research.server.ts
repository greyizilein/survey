// Server-only multi-provider research/citation gathering. Every source
// returned here was actually fetched from a live provider — the writing
// prompt is instructed to cite only from this pool, so references can't be
// fabricated, only drawn from sources that genuinely exist.

export interface SourceItem {
  title: string;
  url: string;
  snippet: string;
  year?: number;
  authors?: string[];
  venue?: string;
  provider: "serper" | "tavily" | "semantic-scholar" | "crossref";
  relevance: number;
}

const TIMEOUT_MS = 9000;

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchSerper(query: string): Promise<SourceItem[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const data = await fetchJson("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    return (data.organic ?? []).map((r: any) => ({
      title: r.title ?? "Untitled",
      url: r.link,
      snippet: r.snippet ?? "",
      year: r.date ? Number((/\d{4}/.exec(r.date) ?? [])[0]) || undefined : undefined,
      provider: "serper" as const,
      relevance: 0,
    })).filter((s: SourceItem) => s.url);
  } catch {
    return [];
  }
}

async function searchTavily(query: string): Promise<SourceItem[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const data = await fetchJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: "advanced" }),
    });
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? "Untitled",
      url: r.url,
      snippet: r.content ?? "",
      year: r.published_date ? Number((/\d{4}/.exec(r.published_date) ?? [])[0]) || undefined : undefined,
      provider: "tavily" as const,
      relevance: typeof r.score === "number" ? r.score : 0,
    })).filter((s: SourceItem) => s.url);
  } catch {
    return [];
  }
}

async function searchSemanticScholar(query: string): Promise<SourceItem[]> {
  try {
    const params = new URLSearchParams({
      query,
      limit: "8",
      fields: "title,abstract,year,authors,venue,url,externalIds,citationCount",
    });
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const data = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, { headers });
    return (data.data ?? []).map((p: any) => ({
      title: p.title ?? "Untitled",
      url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ""),
      snippet: p.abstract ?? "",
      year: p.year ?? undefined,
      authors: (p.authors ?? []).map((a: any) => a.name).filter(Boolean),
      venue: p.venue ?? undefined,
      provider: "semantic-scholar" as const,
      relevance: Math.min(1, (p.citationCount ?? 0) / 200),
    })).filter((s: SourceItem) => s.url);
  } catch {
    return [];
  }
}

async function searchCrossref(query: string): Promise<SourceItem[]> {
  try {
    const params = new URLSearchParams({ query, rows: "8" });
    const data = await fetchJson(`https://api.crossref.org/works?${params}`);
    return (data.message?.items ?? []).map((item: any) => {
      const authors = (item.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
      const year = item["published-print"]?.["date-parts"]?.[0]?.[0] ?? item["published-online"]?.["date-parts"]?.[0]?.[0];
      return {
        title: Array.isArray(item.title) ? item.title[0] ?? "Untitled" : "Untitled",
        url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : ""),
        snippet: Array.isArray(item.subtitle) ? item.subtitle.join(" ") : "",
        year: year ?? undefined,
        authors,
        venue: Array.isArray(item["container-title"]) ? item["container-title"][0] : undefined,
        provider: "crossref" as const,
        relevance: Math.min(1, (item["is-referenced-by-count"] ?? 0) / 200),
      };
    }).filter((s: SourceItem) => s.url);
  } catch {
    return [];
  }
}

function dedupeByUrl(items: SourceItem[]): SourceItem[] {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const item of items) {
    const key = item.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Word-overlap relevance score against the topic, blended with any
// provider-supplied relevance signal (citation count, search rank, etc.).
function scoreRelevance(item: SourceItem, topicWords: Set<string>): number {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const words = new Set(text.split(/\W+/).filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of topicWords) if (words.has(w)) overlap++;
  const overlapScore = topicWords.size ? overlap / topicWords.size : 0;
  return overlapScore * 0.7 + item.relevance * 0.3;
}

export async function gatherSources(topic: string, maxResults = 16): Promise<SourceItem[]> {
  const query = topic.trim().slice(0, 350);
  if (!query) return [];

  const settled = await Promise.allSettled([
    searchSerper(query),
    searchTavily(query),
    searchSemanticScholar(query),
    searchCrossref(query),
  ]);

  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const deduped = dedupeByUrl(all);

  const topicWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const ranked = deduped
    .map((item) => ({ ...item, relevance: scoreRelevance(item, topicWords) }))
    .sort((a, b) => b.relevance - a.relevance);

  return ranked.slice(0, maxResults);
}

export function formatSourcePoolBlock(sources: SourceItem[]): string {
  if (!sources.length) return "";
  const lines = sources.map((s, i) => {
    const authorPart = s.authors?.length ? `${s.authors.join(", ")} ` : "";
    const yearPart = s.year ? `(${s.year}) ` : "(n.d.) ";
    const venuePart = s.venue ? ` ${s.venue}.` : "";
    return `${i + 1}. ${authorPart}${yearPart}${s.title}.${venuePart} Available at: ${s.url} [via ${s.provider}]`;
  });
  return `\n\nVERIFIED SOURCE POOL (every entry below was fetched live from a real provider — Serper, Tavily, Semantic Scholar, or CrossRef — and is a genuine, checkable source. You may ONLY cite works from this pool in your in-text citations and reference list. Never invent an author, year, title, finding, or URL that is not drawn from this list. If a claim needs support and nothing here covers it, write "[citation needed]" instead of fabricating a reference. Your final reference list must be built exclusively from this pool, reproducing titles/authors/years/URLs exactly as given, in the requested referencing style):\n${lines.join("\n")}`;
}
