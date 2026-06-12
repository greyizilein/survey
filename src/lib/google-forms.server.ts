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

  for (const item of items) {
    const itemTitle = String(item?.[1] ?? "").trim();
    const type = Number(item?.[3]);
    if (type === 8) { pageCount++; continue; } // PAGE_BREAK — start of a new section
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
