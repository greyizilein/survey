export type Slide = {
  layout: "title" | "section" | "bullets" | "two-column" | "stat" | "quote" | "timeline" | "grid" | "table" | "closing";
  title?: string;
  subtitle?: string;
  number?: string;
  bullets?: string[];
  body?: string;
  columns?: { heading: string; bullets: string[] }[];
  value?: string;
  label?: string;
  quote?: string;
  author?: string;
  stages?: { label: string; title: string; done?: boolean }[];
  items?: { label: string; color?: string; bullets: string[] }[];
  tableColumns?: string[];
  tableRows?: string[][];
  notes?: string;
};

export type Theme = { primary: string; secondary: string; dark: string; light: string };
export type Deck = { title: string; theme?: Theme; slides: Slide[] };

export const DEFAULT_THEME: Theme = { primary: "1E2761", secondary: "B85042", dark: "1E2761", light: "FFFFFF" };

export function deckTheme(deck: Deck): Theme {
  return { ...DEFAULT_THEME, ...deck.theme };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<![A-Za-z0-9])\*(?!\s)(.+?)(?<!\s)\*(?![A-Za-z0-9])/g, "$1")
    .replace(/(?<![A-Za-z0-9])_(?!\s)(.+?)(?<!\s)_(?![A-Za-z0-9])/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

function sanitizeValue<T>(value: T): T {
  if (typeof value === "string") return stripMarkdown(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeValue) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v);
    return out as T;
  }
  return value;
}

export function sanitizeDeck(deck: Deck): Deck {
  return sanitizeValue(deck);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportDeckToPptx(deck: Deck): Promise<Blob> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const theme = deckTheme(deck);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    if (slide.notes) s.addNotes(slide.notes);

    switch (slide.layout) {
      case "title": {
        s.background = { color: theme.dark };
        s.addText(slide.title ?? deck.title, { x: 0.7, y: 2.6, w: 11.9, h: 1.3, fontSize: 44, bold: true, color: theme.light, align: "left", margin: 0 });
        if (slide.subtitle) {
          s.addText(slide.subtitle, { x: 0.7, y: 3.9, w: 10, h: 0.6, fontSize: 18, color: theme.light, italic: true, margin: 0 });
        }
        break;
      }
      case "section": {
        s.background = { color: theme.dark };
        if (slide.number) s.addText(slide.number, { x: 0.7, y: 1.8, w: 2, h: 1, fontSize: 60, color: theme.secondary, margin: 0 });
        s.addText(slide.title ?? "", { x: 0.7, y: 2.7, w: 10, h: 1, fontSize: 34, bold: true, color: theme.light, margin: 0 });
        break;
      }
      case "bullets": {
        s.background = { color: theme.light };
        s.addText(slide.title ?? "", { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: theme.primary, margin: 0 });
        const bullets = slide.bullets ?? [];
        if (bullets.length) {
          s.addText(bullets.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < bullets.length - 1 } })),
            { x: 0.6, y: 1.5, w: 11.8, h: 4.5, fontSize: 18, color: "33384A", margin: 0 });
        }
        if (slide.body) {
          s.addText(slide.body, { x: 0.6, y: 6.1, w: 11.8, h: 0.7, fontSize: 14, italic: true, color: "6B7299", margin: 0 });
        }
        break;
      }
      case "two-column": {
        s.background = { color: theme.light };
        s.addText(slide.title ?? "", { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: theme.primary, margin: 0 });
        const cols = slide.columns ?? [];
        const colW = 5.9;
        cols.slice(0, 2).forEach((col, i) => {
          const x = 0.6 + i * (colW + 0.5);
          s.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w: colW, h: 4.7, fill: { color: "F4F5FB" }, rectRadius: 0.08, line: { color: "E1E4F2", width: 1 } });
          s.addText(col.heading, { x: x + 0.35, y: 1.75, w: colW - 0.7, h: 0.5, fontSize: 20, bold: true, color: theme.primary, margin: 0 });
          if (col.bullets.length) {
            s.addText(col.bullets.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < col.bullets.length - 1 } })),
              { x: x + 0.35, y: 2.35, w: colW - 0.7, h: 3.6, fontSize: 15, color: "33384A", margin: 0 });
          }
        });
        break;
      }
      case "stat": {
        s.background = { color: theme.light };
        s.addText(slide.value ?? "", { x: 0.7, y: 1.7, w: 7, h: 2, fontSize: 90, bold: true, color: theme.primary, margin: 0 });
        s.addText(slide.label ?? "", { x: 0.7, y: 3.9, w: 7, h: 1, fontSize: 18, color: "44475A", margin: 0 });
        if (slide.body) s.addText(slide.body, { x: 0.7, y: 4.9, w: 7, h: 0.8, fontSize: 14, italic: true, color: "6B7299", margin: 0 });
        break;
      }
      case "quote": {
        s.background = { color: theme.dark };
        s.addText(`"${slide.quote ?? ""}"`, { x: 1.0, y: 1.9, w: 11, h: 2.2, fontSize: 28, italic: true, color: theme.light, margin: 0 });
        if (slide.author) s.addText(slide.author, { x: 1.0, y: 4.4, w: 8, h: 0.5, fontSize: 15, color: theme.secondary, margin: 0 });
        break;
      }
      case "timeline": {
        s.background = { color: theme.light };
        s.addText(slide.title ?? "", { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: theme.primary, margin: 0 });
        const stages = slide.stages ?? [];
        if (stages.length) {
          s.addShape(pptx.ShapeType.line, { x: 0.9, y: 3.6, w: 11.3, h: 0, line: { color: "CBD2E8", width: 2 } });
          stages.forEach((stage, i) => {
            const x = 0.9 + i * (11.3 / Math.max(1, stages.length - 1));
            s.addShape(pptx.ShapeType.ellipse, { x: x - 0.12, y: 3.48, w: 0.24, h: 0.24, fill: { color: stage.done ? theme.primary : theme.light }, line: { color: theme.primary, width: 2 } });
            s.addText(stage.label, { x: x - 0.8, y: 2.95, w: 1.6, h: 0.4, fontSize: 13, color: "6B7299", align: "center", margin: 0 });
            s.addText(stage.title, { x: x - 1.0, y: 3.85, w: 2.0, h: 0.6, fontSize: 14, bold: true, align: "center", color: theme.primary, margin: 0 });
          });
        }
        break;
      }
      case "grid": {
        s.background = { color: theme.light };
        s.addText(slide.title ?? "", { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: theme.primary, margin: 0 });
        const items = (slide.items ?? []).slice(0, 4);
        items.forEach((item, i) => {
          const x = 0.6 + (i % 2) * 6.1, y = 1.5 + Math.floor(i / 2) * 2.6;
          const color = item.color ?? theme.primary;
          s.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.8, h: 2.4, fill: { color: "FFFFFF" }, rectRadius: 0.07, line: { color: "E1E4F2", width: 1 } });
          s.addText(item.label, { x: x + 0.3, y: y + 0.2, w: 5.2, h: 0.5, fontSize: 16, bold: true, color, margin: 0 });
          if (item.bullets.length) {
            s.addText(item.bullets.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < item.bullets.length - 1 } })),
              { x: x + 0.3, y: y + 0.75, w: 5.2, h: 1.5, fontSize: 13, color: "33384A", margin: 0 });
          }
        });
        break;
      }
      case "table": {
        s.background = { color: theme.light };
        s.addText(slide.title ?? "", { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: theme.primary, margin: 0 });
        const cols = slide.tableColumns ?? [];
        const rows = slide.tableRows ?? [];
        if (cols.length) {
          const header = cols.map((c) => ({ text: c, options: { fill: { color: theme.primary }, color: theme.light, bold: true, align: "center" as const } }));
          const body = rows.map((row) => row.map((c) => ({ text: c })));
          s.addTable([header, ...body], { x: 0.6, y: 1.6, w: 12.1, h: 4.5, border: { pt: 1, color: "DDE1F2" }, align: "center", fontSize: 13 });
        }
        break;
      }
      case "closing": {
        s.background = { color: theme.dark };
        s.addText(slide.title ?? "Thank you", { x: 0.7, y: 2.6, w: 10, h: 1, fontSize: 40, bold: true, color: theme.light, margin: 0 });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.7, y: 3.7, w: 10, h: 0.6, fontSize: 16, color: theme.light, margin: 0 });
        break;
      }
    }
  }

  const blob = await pptx.write({ outputType: "blob" });
  return blob as Blob;
}
