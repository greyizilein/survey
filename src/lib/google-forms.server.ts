// Direct Google Forms submission — no browser needed.
//
// Public Google Forms embed their full structure in a JS variable
// (FB_PUBLIC_LOAD_DATA_) on the viewform page, including the entry IDs each
// answer must be posted under. Submitting is then a plain POST to
// .../formResponse. This runs fine on Cloudflare Workers.

export interface GFormQuestion {
  entryId: string;
  title: string;
  type: number; // 0 short, 1 paragraph, 2 choice, 3 dropdown, 4 checkbox, 5 scale, 7 grid row
  options: string[];
  required: boolean;
}

export interface GFormInfo {
  formAction: string;
  title: string;
  questions: GFormQuestion[];
  pageHistory: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function isGoogleFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "docs.google.com" && u.pathname.includes("/forms/")
      || u.hostname === "forms.gle";
  } catch {
    return false;
  }
}

export async function fetchGoogleForm(url: string): Promise<GFormInfo> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`Could not load form (HTTP ${res.status})`);
  const html = await res.text();
  const finalUrl = res.url || url;

  const marker = "FB_PUBLIC_LOAD_DATA_";
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error("This Google Form is not public (it may require sign-in).");
  const start = html.indexOf("=", idx) + 1;
  const end = html.indexOf(";</script>", start);
  if (start === 0 || end === -1) throw new Error("Could not read the form structure.");
  let data: any;
  try {
    data = JSON.parse(html.slice(start, end).trim());
  } catch {
    throw new Error("Could not parse the form structure.");
  }

  const title = String(data?.[1]?.[8] ?? data?.[3] ?? "Google Form");
  const items: any[] = Array.isArray(data?.[1]?.[1]) ? data[1][1] : [];
  const questions: GFormQuestion[] = [];
  let pageCount = 1;

  for (const item of items) {
    const itemTitle = String(item?.[1] ?? "").trim();
    const type = Number(item?.[3]);
    if (type === 8) { pageCount++; continue; } // PAGE_BREAK — start of a new section
    const fields = item?.[4];
    if (!Array.isArray(fields)) continue; // section header / image / video
    for (const field of fields) {
      const entryId = field?.[0];
      if (entryId == null) continue;
      const options = Array.isArray(field?.[1])
        ? field[1].map((o: any) => String(o?.[0] ?? "")).filter(Boolean)
        : [];
      // Grid rows carry their row label in field[3]
      const rowLabel = Array.isArray(field?.[3]) && field[3][0] ? ` — ${String(field[3][0])}` : "";
      questions.push({
        entryId: String(entryId),
        title: itemTitle + rowLabel,
        type,
        options,
        required: Boolean(field?.[2]),
      });
    }
  }

  const actionBase = finalUrl.replace(/\/viewform.*$/, "/formResponse");
  const pageHistory = Array.from({ length: pageCount }, (_, i) => i).join(",");
  return { formAction: actionBase, title, questions, pageHistory };
}

export interface AnswerForEntry {
  entryId: string;
  values: string[];
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
