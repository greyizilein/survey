// Client-side rendering of interview transcripts into download formats.
// The canonical data is an array of turns; everything else (timestamps,
// VTT/TXT/MD/DOCX/PDF) is derived here so output reads like a genuine
// Zoom / Microsoft Teams transcript export.

export interface Turn {
  speaker: string;
  role: "interviewer" | "respondent";
  text: string;
}
export interface TranscriptMeta {
  studyTitle: string;
  interviewer: string;
  respondent: string;
  date: string | null; // ISO
  mode: string; // teams | zoom | in_person
}
export type TranscriptFormat = "vtt" | "txt" | "md" | "docx" | "pdf";

interface Cue {
  start: number; // seconds
  end: number;
  turn: Turn;
}

// Real speech runs ~150 words/min. Add a short pause before each turn so the
// cumulative timing feels like a live conversation rather than a metronome.
function buildCues(turns: Turn[]): Cue[] {
  const WORDS_PER_SEC = 2.5;
  let t = 0;
  const cues: Cue[] = [];
  for (const turn of turns) {
    const words = turn.text.trim().split(/\s+/).filter(Boolean).length;
    const speaking = Math.max(1.5, words / WORDS_PER_SEC);
    const pause = 0.4 + Math.random() * 1.1;
    const start = t + pause;
    const end = start + speaking;
    cues.push({ start, end, turn });
    t = end;
  }
  return cues;
}

function pad(n: number, w = 2) {
  return String(Math.floor(n)).padStart(w, "0");
}
function vttStamp(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
function shortStamp(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${pad(s)}`;
}

function formatDateHeader(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---- VTT (Teams style: <v Speaker>; Zoom style: numbered, "Speaker: text") --
export function toVTT(turns: Turn[], meta: TranscriptMeta): string {
  const cues = buildCues(turns);
  const zoom = meta.mode === "zoom";
  const lines: string[] = ["WEBVTT", ""];
  cues.forEach((c, i) => {
    if (zoom) lines.push(String(i + 1));
    lines.push(`${vttStamp(c.start)} --> ${vttStamp(c.end)}`);
    if (zoom) lines.push(`${c.turn.speaker}: ${c.turn.text}`);
    else lines.push(`<v ${c.turn.speaker}>${c.turn.text}`);
    lines.push("");
  });
  return lines.join("\n");
}

// ---- TXT (mirrors Microsoft Teams "save transcript" text export) -----------
export function toTXT(turns: Turn[], meta: TranscriptMeta): string {
  const cues = buildCues(turns);
  const head = [
    meta.studyTitle,
    `Interview with ${meta.respondent}`,
    meta.date ? formatDateHeader(meta.date) : "",
    "",
  ].filter((l) => l !== undefined).join("\n");
  const body = cues
    .map((c) => `${c.turn.speaker}   ${shortStamp(c.start)}\n${c.turn.text}`)
    .join("\n\n");
  return `${head}\n${body}\n`;
}

// ---- Markdown --------------------------------------------------------------
export function toMD(turns: Turn[], meta: TranscriptMeta): string {
  const cues = buildCues(turns);
  const head = [
    `# ${meta.studyTitle}`,
    ``,
    `**Interview with:** ${meta.respondent}  `,
    `**Interviewer:** ${meta.interviewer}  `,
    meta.date ? `**Date:** ${formatDateHeader(meta.date)}  ` : ``,
    ``,
    `---`,
    ``,
  ].filter((l) => l !== undefined).join("\n");
  const body = cues
    .map((c) => `**${c.turn.speaker}** _(${shortStamp(c.start)})_\n\n${c.turn.text}`)
    .join("\n\n");
  return `${head}${body}\n`;
}

// ---- DOCX ------------------------------------------------------------------
export async function toDOCX(turns: Turn[], meta: TranscriptMeta): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const cues = buildCues(turns);

  const children: any[] = [
    new Paragraph({ text: meta.studyTitle, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `Interview with ${meta.respondent}`, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Interviewer: ${meta.interviewer}`, italics: true })] }),
  ];
  if (meta.date) {
    children.push(new Paragraph({ children: [new TextRun({ text: formatDateHeader(meta.date), italics: true })] }));
  }
  children.push(new Paragraph({ text: "" }));

  for (const c of cues) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${c.turn.speaker}  `, bold: true }),
          new TextRun({ text: shortStamp(c.start), italics: true, color: "888888" }),
        ],
      }),
      new Paragraph({ text: c.turn.text }),
      new Paragraph({ text: "" }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

// ---- PDF -------------------------------------------------------------------
export async function toPDF(turns: Turn[], meta: TranscriptMeta): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const cues = buildCues(turns);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  const ensure = (h: number) => {
    if (y + h > bottom) { doc.addPage(); y = margin; }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  ensure(20);
  doc.text(meta.studyTitle, margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  ensure(14);
  doc.text(`Interview with ${meta.respondent} · Interviewer: ${meta.interviewer}`, margin, y);
  y += 13;
  if (meta.date) { ensure(14); doc.text(formatDateHeader(meta.date), margin, y); y += 13; }
  y += 8;
  doc.setTextColor(20);

  for (const c of cues) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    ensure(16);
    doc.text(`${c.turn.speaker}  ${shortStamp(c.start)}`, margin, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(c.turn.text, width) as string[];
    for (const line of lines) {
      ensure(15);
      doc.text(line, margin, y);
      y += 15;
    }
    y += 8;
  }

  return doc.output("blob");
}

export function transcriptFilename(meta: TranscriptMeta, format: TranscriptFormat) {
  const safe = meta.respondent.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${safe || "interview"}.${format}`;
}

export async function renderTranscript(
  turns: Turn[],
  meta: TranscriptMeta,
  format: TranscriptFormat,
): Promise<{ blob: Blob; filename: string }> {
  const filename = transcriptFilename(meta, format);
  let blob: Blob;
  if (format === "docx") blob = await toDOCX(turns, meta);
  else if (format === "pdf") blob = await toPDF(turns, meta);
  else if (format === "vtt") blob = new Blob([toVTT(turns, meta)], { type: "text/vtt" });
  else if (format === "md") blob = new Blob([toMD(turns, meta)], { type: "text/markdown" });
  else blob = new Blob([toTXT(turns, meta)], { type: "text/plain" });
  return { blob, filename };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Bundle every participant's transcript into one zip in the chosen format.
export async function downloadAllAsZip(
  items: { turns: Turn[]; meta: TranscriptMeta }[],
  format: TranscriptFormat,
  zipName: string,
) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const item of items) {
    if (!item.turns?.length) continue;
    const { blob, filename } = await renderTranscript(item.turns, item.meta, format);
    let name = filename;
    let n = 2;
    while (used.has(name)) { name = filename.replace(/(\.\w+)$/, `_${n++}$1`); }
    used.add(name);
    zip.file(name, blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, zipName);
}
