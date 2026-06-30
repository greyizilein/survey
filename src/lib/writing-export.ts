import { parseMarkdownLite, splitInlineRuns, TABLE_SEPARATOR_RE } from "./markdown-lite";

/** Map of figure index → { base64, mediaType } for inline image embedding */
export type FigureMap = Record<number, { base64: string; mediaType: string; caption?: string }>;

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

export async function exportToDocx(text: string, title?: string, figures?: FigureMap): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ImageRun,
    AlignmentType,
  } = await import("docx");
  const blocks = parseMarkdownLite(text);

  const HEADING_LEVELS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ];

  function runsFor(t: string) {
    return splitInlineRuns(t).map(
      (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }),
    );
  }

  // Only stamp a title heading when a real one is supplied. The document's own content
  // already carries its headings — never inject an app/template name as the title.
  const children: any[] = title?.trim()
    ? [
        new Paragraph({ text: title.trim(), heading: HeadingLevel.TITLE }),
        new Paragraph({ text: "" }),
      ]
    : [];

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(
        new Paragraph({
          children: runsFor(block.text),
          heading: HEADING_LEVELS[block.level - 1] ?? HeadingLevel.HEADING_4,
        }),
      );
      continue;
    }
    if (block.type === "table") {
      const headerRow = new TableRow({
        children: block.header.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })],
            }),
        ),
      });
      const rows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map((c) => new TableCell({ children: [new Paragraph({ text: c })] })),
          }),
      );
      children.push(
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }),
        new Paragraph({ text: "" }),
      );
      continue;
    }
    if (block.type === "figureplaceholder") {
      const fig = figures?.[block.index];
      if (fig) {
        const imgData = Uint8Array.from(atob(fig.base64), (c) => c.charCodeAt(0));
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: imgData,
                transformation: { width: 480, height: 360 },
                type: fig.mediaType === "image/png" ? "png" : "jpg",
              }),
            ],
          }),
        );
        if (block.caption) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: block.caption, italics: true, size: 20 })],
            }),
          );
        }
        children.push(new Paragraph({ text: "" }));
      } else {
        // Still generating or failed — leave a labelled placeholder
        const label = block.caption ? block.caption : `Figure ${block.index + 1}`;
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `[${label}]`, italics: true, color: "888888" })],
          }),
          new Paragraph({ text: "" }),
        );
      }
      continue;
    }
    if (block.type === "list") {
      for (const item of block.items) {
        children.push(
          new Paragraph({
            bullet: block.ordered ? undefined : { level: 0 },
            children: runsFor(item),
          }),
        );
      }
      children.push(new Paragraph({ text: "" }));
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

export type CoverPageSpec = {
  title: string;
  documentType?: string;
  fields: { label: string; value: string }[];
};

/** Splits a leading `@@COVERPAGE@@{json}` marker line off formatted-document text. */
export function splitCoverPage(raw: string): { body: string; cover: CoverPageSpec | null } {
  const lines = raw.split("\n");
  let cover: CoverPageSpec | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const match = /^@@COVERPAGE@@(.*)$/.exec(line);
    if (match) {
      try {
        cover = JSON.parse(match[1]);
      } catch {
        /* still streaming */
      }
      continue;
    }
    kept.push(line);
  }
  return { body: kept.join("\n"), cover };
}

/** Submission-ready export: cover page, native Word table of contents, then the formatted body. */
export async function exportFormattedDocx(
  bodyText: string,
  cover: CoverPageSpec | null,
  figures?: FigureMap,
): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    PageBreak,
    Table,
    TableRow,
    TableCell,
    WidthType,
    TableOfContents,
    ImageRun,
  } = await import("docx");
  const blocks = parseMarkdownLite(bodyText);
  const HEADING_LEVELS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ];

  function runsFor(t: string) {
    return splitInlineRuns(t).map(
      (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }),
    );
  }

  const children: any[] = [];

  if (cover) {
    children.push(
      new Paragraph({ text: "" }),
      new Paragraph({ text: "" }),
      new Paragraph({ text: "" }),
      new Paragraph({
        text: cover.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
    );
    if (cover.documentType) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: cover.documentType, italics: true })],
          alignment: AlignmentType.CENTER,
        }),
      );
    }
    children.push(new Paragraph({ text: "" }), new Paragraph({ text: "" }));
    for (const f of cover.fields) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${f.label}: `, bold: true }),
            new TextRun({ text: f.value }),
          ],
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
      children.push(
        new Paragraph({
          children: runsFor(block.text),
          heading: HEADING_LEVELS[block.level - 1] ?? HeadingLevel.HEADING_4,
        }),
      );
      continue;
    }
    if (block.type === "table") {
      const headerRow = new TableRow({
        children: block.header.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })],
            }),
        ),
      });
      const rows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map((c) => new TableCell({ children: [new Paragraph({ text: c })] })),
          }),
      );
      children.push(
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }),
        new Paragraph({ text: "" }),
      );
      continue;
    }
    if (block.type === "figureplaceholder") {
      const fig = figures?.[block.index];
      if (fig) {
        const imgData = Uint8Array.from(atob(fig.base64), (c) => c.charCodeAt(0));
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: imgData,
                transformation: { width: 480, height: 360 },
                type: fig.mediaType === "image/png" ? "png" : "jpg",
              }),
            ],
          }),
        );
        if (block.caption) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: block.caption, italics: true, size: 20 })],
            }),
          );
        }
        children.push(new Paragraph({ text: "" }));
      } else {
        const label = block.caption ? block.caption : `Figure ${block.index + 1}`;
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `[${label}]`, italics: true, color: "888888" })],
          }),
          new Paragraph({ text: "" }),
        );
      }
      continue;
    }
    if (block.type === "list") {
      for (const item of block.items) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: runsFor(item) }));
      }
      children.push(new Paragraph({ text: "" }));
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

/** Submission-ready export as PDF — same cover page + body content as the docx export. */
export async function exportFormattedPdf(
  bodyText: string,
  cover: CoverPageSpec | null,
  figures?: FigureMap,
): Promise<Blob> {
  // @ts-expect-error - subpath import to bypass jspdf exports map issue under Vite/Worker SSR
  const { jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
  const blocks = parseMarkdownLite(bodyText);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  const ensure = (h: number) => {
    if (y + h > bottom) {
      doc.addPage();
      y = margin;
    }
  };

  const HEADING_SIZES = [18, 15, 13, 11.5];

  if (cover) {
    doc.setFont("times", "bold");
    doc.setFontSize(22);
    const titleLines = doc.splitTextToSize(cover.title, width) as string[];
    y = doc.internal.pageSize.getHeight() / 3;
    for (const line of titleLines) {
      doc.text(line, doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
      y += 26;
    }
    if (cover.documentType) {
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      y += 10;
      doc.text(cover.documentType, doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
      y += 30;
    } else {
      y += 20;
    }
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    for (const f of cover.fields) {
      doc.text(`${f.label}: ${f.value}`, doc.internal.pageSize.getWidth() / 2, y, {
        align: "center",
      });
      y += 18;
    }
    doc.addPage();
    y = margin;
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      doc.setFont("times", "bold");
      doc.setFontSize(HEADING_SIZES[block.level - 1] ?? 11.5);
      ensure(24);
      const lines = doc.splitTextToSize(block.text, width) as string[];
      for (const line of lines) {
        ensure(20);
        doc.text(line, margin, y);
        y += 20;
      }
      y += 6;
      continue;
    }
    if (block.type === "table") {
      doc.setFont("times", "bold");
      doc.setFontSize(11);
      const colWidth = width / Math.max(block.header.length, 1);
      ensure(16);
      block.header.forEach((c, i) => doc.text(c, margin + i * colWidth, y));
      y += 16;
      doc.setFont("times", "normal");
      for (const row of block.rows) {
        ensure(16);
        row.forEach((c, i) => doc.text(String(c).slice(0, 40), margin + i * colWidth, y));
        y += 16;
      }
      y += 10;
      continue;
    }
    if (block.type === "figureplaceholder") {
      const fig = figures?.[block.index];
      if (fig) {
        const imgH = 180;
        ensure(imgH + 20);
        const imgW = Math.min(width, 320);
        const imgX = margin + (width - imgW) / 2;
        doc.addImage(`data:${fig.mediaType};base64,${fig.base64}`, "JPEG", imgX, y, imgW, imgH);
        y += imgH + 6;
        if (block.caption) {
          doc.setFont("times", "italic");
          doc.setFontSize(10);
          const capLines = doc.splitTextToSize(block.caption, width) as string[];
          for (const line of capLines) {
            ensure(14);
            doc.text(line, doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
            y += 14;
          }
        }
        y += 10;
      } else {
        const label = block.caption ? block.caption : `Figure ${block.index + 1}`;
        ensure(20);
        doc.setFont("times", "italic");
        doc.setFontSize(11);
        doc.text(`[${label}]`, doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
        y += 20;
      }
      continue;
    }
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    if (block.type === "list") {
      for (const item of block.items) {
        const prefix = block.ordered ? `${block.items.indexOf(item) + 1}. ` : "• ";
        const wrapped = doc.splitTextToSize(prefix + item, width) as string[];
        for (const w of wrapped) { ensure(16); doc.text(w, margin, y); y += 16; }
      }
    } else {
      for (const line of block.text.split("\n")) {
        const wrapped = doc.splitTextToSize(line, width) as string[];
        for (const w of wrapped) {
          ensure(16);
          doc.text(w, margin, y);
          y += 16;
        }
      }
    }
    y += 8;
  }

  return doc.output("blob");
}

/** Submission-ready export as PPTX — useful when the original work was itself a slide deck. */
export async function exportFormattedPptx(
  bodyText: string,
  cover: CoverPageSpec | null,
): Promise<Blob> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const blocks = parseMarkdownLite(bodyText);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  if (cover?.title) pptx.title = cover.title;

  if (cover) {
    const s = pptx.addSlide();
    s.addText(cover.title, {
      x: 0.5,
      y: 1.2,
      w: 12.3,
      h: 1.2,
      fontSize: 32,
      bold: true,
      align: "center",
    });
    if (cover.documentType) {
      s.addText(cover.documentType, {
        x: 0.5,
        y: 2.4,
        w: 12.3,
        h: 0.6,
        fontSize: 16,
        italic: true,
        align: "center",
      });
    }
    s.addText(cover.fields.map((f) => `${f.label}: ${f.value}`).join("\n"), {
      x: 0.5,
      y: 3.3,
      w: 12.3,
      h: 2.5,
      fontSize: 14,
      align: "center",
    });
  }

  let slide = pptx.addSlide();
  let y = 0.5;
  const newSlideIfNeeded = (h: number) => {
    if (y + h > 6.8) {
      slide = pptx.addSlide();
      y = 0.5;
    }
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      newSlideIfNeeded(0.8);
      slide.addText(block.text, {
        x: 0.5,
        y,
        w: 12.3,
        h: 0.7,
        fontSize: block.level === 1 ? 26 : 20,
        bold: true,
      });
      y += 0.8;
      continue;
    }
    if (block.type === "table") {
      newSlideIfNeeded(0.5);
      const rows = [block.header, ...block.rows].map((r) =>
        r.map((c) => ({ text: c, options: { fontSize: 10 } })),
      );
      const h = Math.min(0.4 * rows.length, 6.5 - y);
      slide.addTable(rows as any, { x: 0.5, y, w: 12.3, h, fontSize: 10 });
      y += h + 0.3;
      continue;
    }
    if (block.type === "list") {
      const listText = block.items.map((item, idx) => (block.ordered ? `${idx + 1}. ${item}` : `• ${item}`)).join("\n");
      newSlideIfNeeded(0.6);
      slide.addText(listText, { x: 0.5, y, w: 12.3, h: 1, fontSize: 12, valign: "top" });
      y += Math.min(2.5, 0.3 + listText.length / 200);
    } else if (block.type === "figureplaceholder") {
      // PPTX: skip image embedding for now, show caption label
      const label = block.caption ? block.caption : `Figure ${block.index + 1}`;
      newSlideIfNeeded(0.4);
      slide.addText(`[${label}]`, { x: 0.5, y, w: 12.3, h: 0.4, fontSize: 11, italic: true, align: "center" });
      y += 0.5;
    } else {
      newSlideIfNeeded(0.6);
      slide.addText(block.text, { x: 0.5, y, w: 12.3, h: 1, fontSize: 12, valign: "top" });
      y += Math.min(2.5, 0.3 + block.text.length / 200);
    }
  }

  const blob = await pptx.write({ outputType: "blob" });
  return blob as Blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
