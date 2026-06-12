// Direct Google Forms submission — no browser needed.
//
// Public Google Forms embed their full structure in a JS variable
// (FB_PUBLIC_LOAD_DATA_) on the viewform page, including the entry IDs each
// answer must be posted under. Submitting is then a plain POST to
// .../formResponse. This runs fine on Cloudflare Workers.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface GFormQuestion {
  entryId: string;
  title: string;
  type: number; // 0 short, 1 paragraph, 2 choice, 3 dropdown, 4 checkbox, 5 scale, 7 grid row
  options: string[];
  required: boolean;
}

export interface GFormInfo {
  action: string;
  title: string;
  questions: GFormQuestion[];
  pageHistory: string;
}

export interface AnswerForEntry {
  entryId: string;
  values: string[];
}

export function isGoogleFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)docs\.google\.com$/i.test(u.hostname) && /\/forms\//i.test(u.pathname);
  } catch {
    return false;
  }
}

export async function fetchGoogleForm(url: string): Promise<GFormInfo> {
  const viewUrl = url.replace(/\/(edit|formResponse).*$/, "/viewform").split("?")[0];
  const res = await fetch(viewUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to load Google Form (${res.status})`);
  const html = await res.text();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? "Google Form").replace(/\s*-\s*Google Forms?\s*$/i, "").trim();

  const actionMatch = html.match(/action="([^"]*formResponse[^"]*)"/i);
  const action = actionMatch ? decodeHtml(actionMatch[1]) : viewUrl.replace(/\/viewform$/, "/formResponse");

  const dataMatch = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!dataMatch) throw new Error("Could not parse Google Form structure.");
  const data = JSON.parse(dataMatch[1]);
  const items: any[] = data?.[1]?.[1] ?? [];

  const questions: GFormQuestion[] = [];
  let pageCount = 0;
  for (const item of items) {
    const itemTitle = String(item?.[1] ?? "").trim();
    const type = Number(item?.[3]);
    if (type === 8) { pageCount++; continue; } // PAGE_BREAK
    const fields: any[] = item?.[4] ?? [];
    for (const f of fields) {
      const entryId = String(f?.[0] ?? "");
      if (!entryId) continue;
      const optionsRaw: any[] = f?.[1] ?? [];
      const options = optionsRaw.map((o) => String(o?.[0] ?? "")).filter(Boolean);
      const required = Boolean(f?.[2]);
      questions.push({ entryId, title: itemTitle, type, options, required });
    }
  }

  const pageHistory = Array.from({ length: pageCount + 1 }, (_, i) => i).join(",");
  return { action, title, questions, pageHistory };
}

export async function submitGoogleForm(formAction: string, answers: AnswerForEntry[], pageHistory = "0"): Promise<boolean> {
  const body = new URLSearchParams();
  for (const a of answers) {
    for (const v of a.values) body.append(`entry.${a.entryId}`, v);
  }
  body.append("fvv", "1");
  body.append("pageHistory", pageHistory);

  const res = await fetch(formAction, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: body.toString(),
    redirect: "follow",
  });
  if (!res.ok) return false;
  const text = await res.text();
  return /freebirdFormviewerViewResponseConfirmation|Your response has been recorded|formResponse/i.test(text) || res.ok;
}

function decodeHtml(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
