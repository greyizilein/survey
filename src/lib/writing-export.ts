import { parseMarkdownLite, splitInlineRuns, TABLE_SEPARATOR_RE } from "./markdown-lite";

// Heuristic for "is this assistant message an actual written section, not
// chat chatter" — excludes the executable prompt-table spec itself and short
// clarifying-question turns, keeping only substantial written content.
export function isWrittenSection(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (TABLE_SEPARATOR_RE.test(trimmed) || /\|\s*:?-{2,}:?\s*\|/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 30;
}

export function compileWrittenSections(assistantMessages: string[]): string {
  return assistantMessages.filter(isWrittenSection).join("\n\n");
}

export async function exportToDocx(text: string, title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await import("docx");
  const blocks = parseMarkdownLite(text);

  const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

  function runsFor(t: string) {
    return splitInlineRuns(t).map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }));
  }

  const children: any[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), new Paragraph({ text: "" })];

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ children: runsFor(block.text), heading: HEADING_LEVELS[block.level - 1] ?? HeadingLevel.HEADING_4 }));
      continue;
    }
    if (block.type === "table") {
      const headerRow = new TableRow({
        children: block.header.map((c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })] })),
      });
      const rows = block.rows.map(
        (row) => new TableRow({ children: row.map((c) => new TableCell({ children: [new Paragraph({ text: c })] })) }),
      );
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }), new Paragraph({ text: "" }));
      continue;
    }
    for (const line of block.text.split("\n")) {
      children.push(new Paragraph({ children: runsFor(line) }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

export type CoverPageSpec = { title: string; documentType?: string; fields: { label: string; value: string }[] };

/** Splits a leading `@@COVERPAGE@@{json}` marker line off formatted-document text. */
export function splitCoverPage(raw: string): { body: string; cover: CoverPageSpec | null } {
  const lines = raw.split("\n");
  let cover: CoverPageSpec | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const match = /^@@COVERPAGE@@(.*)$/.exec(line);
    if (match) {
      try { cover = JSON.parse(match[1]); } catch { /* still streaming */ }
      continue;
    }
    kept.push(line);
  }
  return { body: kept.join("\n"), cover };
}

/** Submission-ready export: cover page, native Word table of contents, then the formatted body. */
export async function exportFormattedDocx(bodyText: string, cover: CoverPageSpec | null): Promise<Blob> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
    Table, TableRow, TableCell, WidthType, TableOfContents,
  } = await import("docx");
  const blocks = parseMarkdownLite(bodyText);
  const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

  function runsFor(t: string) {
    return splitInlineRuns(t).map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }));
  }

  const children: any[] = [];

  if (cover) {
    children.push(
      new Paragraph({ text: "" }),
      new Paragraph({ text: "" }),
      new Paragraph({ text: "" }),
      new Paragraph({ text: cover.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    );
    if (cover.documentType) {
      children.push(new Paragraph({ children: [new TextRun({ text: cover.documentType, italics: true })], alignment: AlignmentType.CENTER }));
    }
    children.push(new Paragraph({ text: "" }), new Paragraph({ text: "" }));
    for (const f of cover.fields) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `${f.label}: `, bold: true }), new TextRun({ text: f.value })],
        }),
      );
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(
      new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ children: runsFor(block.text), heading: HEADING_LEVELS[block.level - 1] ?? HeadingLevel.HEADING_4 }));
      continue;
    }
    if (block.type === "table") {
      const headerRow = new TableRow({
        children: block.header.map((c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })] })),
      });
      const rows = block.rows.map(
        (row) => new TableRow({ children: row.map((c) => new TableCell({ children: [new Paragraph({ text: c })] })) }),
      );
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }), new Paragraph({ text: "" }));
      continue;
    }
    for (const line of block.text.split("\n")) {
      children.push(new Paragraph({ children: runsFor(line) }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: 24 } },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
