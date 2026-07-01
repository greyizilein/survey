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
  styleGuide = "APA",
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
    Header,
    Footer,
    PageNumberElement,
    BorderStyle,
    convertInchesToTwip,
    LineRuleType,
  } = await import("docx");

  const blocks = parseMarkdownLite(bodyText);

  const HEADING_LEVELS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ];

  // 1 inch = 1440 twips
  const INCH = convertInchesToTwip(1);
  const HALF_INCH = convertInchesToTwip(0.5);
  // Double spacing = 480 twips (240 = single)
  const DOUBLE_SPACE = { line: 480, lineRule: LineRuleType.AUTO };
  const BODY_FONT = "Times New Roman";
  const BODY_SIZE = 24; // half-points → 12pt

  function runsFor(t: string, extraOpts: Record<string, unknown> = {}) {
    return splitInlineRuns(t).map(
      (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: BODY_FONT, size: BODY_SIZE, ...extraOpts }),
    );
  }

  // Shared paragraph props for body text: double spacing + first-line indent
  function bodyParagraph(text: string, opts: Record<string, unknown> = {}): InstanceType<typeof Paragraph> {
    return new Paragraph({
      children: runsFor(text),
      spacing: DOUBLE_SPACE,
      indent: { firstLine: HALF_INCH },
      ...opts,
    });
  }

  // Hanging indent paragraph (for References/Bibliography entries)
  function hangingParagraph(text: string): InstanceType<typeof Paragraph> {
    return new Paragraph({
      children: runsFor(text),
      spacing: DOUBLE_SPACE,
      indent: { left: HALF_INCH, hanging: HALF_INCH },
    });
  }

  // Detect whether a heading is the References/Bibliography section
  function isReferenceHeading(text: string): boolean {
    return /^(references|bibliography|works cited|reference list)$/i.test(text.trim());
  }

  // Running head for APA: "SHORTENED TITLE" flush left, page number flush right
  const runningHeadText = cover?.title
    ? cover.title.toUpperCase().slice(0, 50)
    : "RUNNING HEAD";

  // Style-guide-specific header/footer
  const isApa = /^apa/i.test(styleGuide);
  const isMla = /^mla/i.test(styleGuide);

  const bodyHeader = isApa
    ? new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: runningHeadText, font: BODY_FONT, size: BODY_SIZE }),
              new TextRun({ children: [new PageNumberElement()], font: BODY_FONT, size: BODY_SIZE }),
            ],
            // Space-between: running head left, page number right
            tabStops: [{ type: "right", position: 9360 }],
          }),
        ],
      })
    : new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: cover?.fields.find(f => /name/i.test(f.label))?.value ?? "", font: BODY_FONT, size: BODY_SIZE }),
              new TextRun({ text: "\t", font: BODY_FONT }),
              new TextRun({ children: [new PageNumberElement()], font: BODY_FONT, size: BODY_SIZE }),
            ],
          }),
        ],
      });

  const bodyFooter = isMla
    ? new Footer({ children: [new Paragraph({ text: "" })] })
    : new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new PageNumberElement()],
          }),
        ],
      });

  // ── Cover section (no header/footer, no page numbers) ──────────────────────
  const coverChildren: any[] = [];

  if (cover) {
    // Vertical centering approximated with spacer paragraphs
    for (let i = 0; i < 8; i++) coverChildren.push(new Paragraph({ text: "" }));

    coverChildren.push(
      new Paragraph({
        children: [new TextRun({ text: cover.title, bold: true, font: BODY_FONT, size: 32 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }),
    );
    if (cover.documentType) {
      coverChildren.push(
        new Paragraph({
          children: [new TextRun({ text: cover.documentType, italics: true, font: BODY_FONT, size: BODY_SIZE })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
        }),
      );
    } else {
      coverChildren.push(new Paragraph({ text: "" }));
    }
    for (const f of cover.fields) {
      coverChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: 360, lineRule: LineRuleType.AUTO },
          children: [
            new TextRun({ text: `${f.label}: `, bold: true, font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: f.value, font: BODY_FONT, size: BODY_SIZE }),
          ],
        }),
      );
    }
  }

  // ── TOC section ────────────────────────────────────────────────────────────
  const tocChildren: any[] = [
    new Paragraph({
      children: [new TextRun({ text: "Table of Contents", bold: true, font: BODY_FONT, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }),
    new TableOfContents("", { hyperlink: true, headingStyleRange: "1-3" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── Body section ───────────────────────────────────────────────────────────
  const bodyChildren: any[] = [];
  let tableCounter = 0;
  let figureCounter = 0;
  let inReferencesSection = false;

  for (const block of blocks) {
    if (block.type === "heading") {
      inReferencesSection = isReferenceHeading(block.text);
      const level = block.level;
      const isH1 = level === 1;

      // APA heading styles: L1 = centered bold, L2 = left bold, L3 = left bold italic, L4 = indented bold
      if (isApa) {
        bodyChildren.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, bold: true, italics: level === 3, font: BODY_FONT, size: BODY_SIZE })],
            heading: HEADING_LEVELS[level - 1] ?? HeadingLevel.HEADING_4,
            alignment: isH1 ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 240, after: 0, line: 480, lineRule: LineRuleType.AUTO },
            indent: level === 4 ? { firstLine: HALF_INCH } : undefined,
          }),
        );
      } else {
        bodyChildren.push(
          new Paragraph({
            children: runsFor(block.text, { bold: level <= 2 }),
            heading: HEADING_LEVELS[level - 1] ?? HeadingLevel.HEADING_4,
            alignment: AlignmentType.LEFT,
            spacing: { before: 240, after: 0, line: 480, lineRule: LineRuleType.AUTO },
          }),
        );
      }
      continue;
    }

    if (block.type === "table") {
      tableCounter++;
      // Table label above (APA: "Table N" then italic note below)
      bodyChildren.push(
        new Paragraph({
          children: [new TextRun({ text: `Table ${tableCounter}`, italics: false, bold: false, font: BODY_FONT, size: BODY_SIZE })],
          spacing: { before: 360, after: 0 },
        }),
      );
      // Table title (if heading immediately preceded this block, skip; otherwise use generic)
      const apaBorders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
        left: { style: BorderStyle.NONE, size: 0 },
        right: { style: BorderStyle.NONE, size: 0 },
        insideVertical: { style: BorderStyle.NONE, size: 0 },
      };
      const headerRow = new TableRow({
        tableHeader: true,
        children: block.header.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, font: BODY_FONT, size: BODY_SIZE })], spacing: { line: 240 } })],
            }),
        ),
      });
      const rows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map((c) => new TableCell({
              children: [new Paragraph({ children: runsFor(c), spacing: { line: 240 } })],
            })),
          }),
      );
      bodyChildren.push(
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: apaBorders, rows: [headerRow, ...rows] }),
        new Paragraph({ text: "", spacing: { after: 240 } }),
      );
      continue;
    }

    if (block.type === "figureplaceholder") {
      figureCounter++;
      const fig = figures?.[block.index];
      if (fig) {
        const imgData = Uint8Array.from(atob(fig.base64), (c) => c.charCodeAt(0));
        bodyChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 360, after: 60 },
            children: [
              new ImageRun({
                data: imgData,
                transformation: { width: 468, height: 351 },
                type: fig.mediaType === "image/png" ? "png" : "jpg",
              }),
            ],
          }),
        );
      } else {
        bodyChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 360, after: 60 },
            children: [new TextRun({ text: `[Figure ${figureCounter} — image not available]`, italics: true, color: "888888", font: BODY_FONT, size: BODY_SIZE })],
          }),
        );
      }
      // Figure label + caption below (APA: "Figure N" italic, then caption text)
      const captionText = block.caption || "";
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 360 },
          children: [
            new TextRun({ text: `Figure ${figureCounter}`, italics: true, font: BODY_FONT, size: BODY_SIZE }),
            ...(captionText ? [new TextRun({ text: `  ${captionText}`, font: BODY_FONT, size: BODY_SIZE })] : []),
          ],
        }),
      );
      continue;
    }

    if (block.type === "list") {
      for (const item of block.items) {
        bodyChildren.push(
          new Paragraph({
            bullet: { level: 0 },
            children: runsFor(item),
            spacing: { line: 480, lineRule: LineRuleType.AUTO },
          }),
        );
      }
      continue;
    }

    if (block.type === "blockquote") {
      // Block quotations (40+ words): indented 0.5in both sides, no first-line indent
      bodyChildren.push(
        new Paragraph({
          children: runsFor(block.text),
          spacing: DOUBLE_SPACE,
          indent: { left: HALF_INCH, right: HALF_INCH },
        }),
      );
      continue;
    }

    // Regular paragraph
    const lines = block.text.split("\n").filter(Boolean);
    for (const line of lines) {
      if (inReferencesSection) {
        bodyChildren.push(hangingParagraph(line));
      } else {
        bodyChildren.push(bodyParagraph(line));
      }
    }
  }

  // ── Assemble document with separate sections ───────────────────────────────
  const pageMargins = { top: INCH, bottom: INCH, left: INCH, right: INCH, header: 720, footer: 720 };

  const sections: any[] = [];

  if (cover) {
    sections.push({
      properties: {
        titlePage: false,
        page: { margin: pageMargins },
      },
      children: coverChildren,
    });
    sections.push({
      properties: { page: { margin: pageMargins } },
      headers: { default: new Header({ children: [new Paragraph({ text: "" })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ text: "" })] }) },
      children: tocChildren,
    });
  }

  sections.push({
    properties: { page: { margin: pageMargins } },
    headers: { default: bodyHeader },
    footers: { default: bodyFooter },
    children: bodyChildren.length ? bodyChildren : [new Paragraph({ text: "" })],
  });

  const doc = new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
          paragraph: { spacing: DOUBLE_SPACE },
        },
        heading1: {
          run: { font: BODY_FONT, size: BODY_SIZE, bold: true },
        },
        heading2: {
          run: { font: BODY_FONT, size: BODY_SIZE, bold: true },
        },
        heading3: {
          run: { font: BODY_FONT, size: BODY_SIZE, bold: true, italics: true },
        },
        heading4: {
          run: { font: BODY_FONT, size: BODY_SIZE, bold: true },
        },
      },
    },
    sections,
  });
  return Packer.toBlob(doc);
}

/** Submission-ready export as PDF — 1-inch margins, 12pt Times New Roman, double spacing. */
export async function exportFormattedPdf(
  bodyText: string,
  cover: CoverPageSpec | null,
  figures?: FigureMap,
  styleGuide = "APA",
): Promise<Blob> {
  // @ts-expect-error - subpath import to bypass jspdf exports map issue under Vite/Worker SSR
  const { jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
  const blocks = parseMarkdownLite(bodyText);

  // A4 in points: 595.28 x 841.89. 1 inch = 72pt.
  const MARGIN = 72; // 1 inch
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const BOTTOM = PAGE_H - MARGIN;
  const HEADER_Y = 36; // 0.5 inch from top
  const LINE_HEIGHT = 28; // ~double spacing at 12pt
  const BODY_SIZE = 12;
  const INDENT = 36; // 0.5 inch first-line indent
  const HANG = 36;   // 0.5 inch hanging indent

  const isApa = /^apa/i.test(styleGuide);
  const runningHead = cover?.title ? cover.title.toUpperCase().slice(0, 50) : "";

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = MARGIN;
  let pageNum = 0;

  function addPage() {
    doc.addPage();
    pageNum++;
    y = MARGIN;
    // Header: running head (APA) or page number right (others)
    doc.setFont("times", "normal");
    doc.setFontSize(BODY_SIZE);
    if (isApa && runningHead) {
      doc.text(runningHead, MARGIN, HEADER_Y);
    }
    doc.text(String(pageNum), PAGE_W - MARGIN, HEADER_Y, { align: "right" });
  }

  function ensure(h: number) {
    if (y + h > BOTTOM) addPage();
  }

  function textLines(text: string, indent = 0): string[] {
    return doc.splitTextToSize(text, CONTENT_W - indent) as string[];
  }

  // ── Cover page ─────────────────────────────────────────────────────────────
  if (cover) {
    doc.setFont("times", "bold");
    doc.setFontSize(18);
    const titleWrapped = doc.splitTextToSize(cover.title, CONTENT_W) as string[];
    let coverY = PAGE_H * 0.35;
    for (const line of titleWrapped) {
      doc.text(line, PAGE_W / 2, coverY, { align: "center" });
      coverY += 24;
    }
    if (cover.documentType) {
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      coverY += 8;
      doc.text(cover.documentType, PAGE_W / 2, coverY, { align: "center" });
      coverY += 24;
    }
    doc.setFont("times", "normal");
    doc.setFontSize(BODY_SIZE);
    coverY += 12;
    for (const f of cover.fields) {
      doc.text(`${f.label}: ${f.value}`, PAGE_W / 2, coverY, { align: "center" });
      coverY += 22;
    }
    addPage();
  } else {
    pageNum = 1;
    if (isApa && runningHead) {
      doc.setFont("times", "normal");
      doc.setFontSize(BODY_SIZE);
      doc.text(runningHead, MARGIN, HEADER_Y);
    }
    doc.setFont("times", "normal");
    doc.setFontSize(BODY_SIZE);
    doc.text("1", PAGE_W - MARGIN, HEADER_Y, { align: "right" });
  }

  const HEADING_SIZES = [16, 14, 13, 12];
  let tableCounter = 0;
  let figureCounter = 0;
  let inReferencesSection = false;

  for (const block of blocks) {
    if (block.type === "heading") {
      inReferencesSection = /^(references|bibliography|works cited|reference list)$/i.test(block.text.trim());
      doc.setFont("times", "bold");
      doc.setFontSize(HEADING_SIZES[block.level - 1] ?? BODY_SIZE);
      ensure(LINE_HEIGHT + 12);
      y += 12;
      const lines = doc.splitTextToSize(block.text, CONTENT_W) as string[];
      const xPos = (isApa && block.level === 1) ? PAGE_W / 2 : MARGIN;
      const align = (isApa && block.level === 1) ? "center" : "left";
      for (const line of lines) {
        ensure(LINE_HEIGHT);
        doc.text(line, xPos, y, { align });
        y += LINE_HEIGHT;
      }
      continue;
    }

    if (block.type === "table") {
      tableCounter++;
      doc.setFont("times", "normal");
      doc.setFontSize(BODY_SIZE);
      ensure(LINE_HEIGHT * 2);
      y += 12;
      // "Table N" label
      doc.text(`Table ${tableCounter}`, MARGIN, y);
      y += LINE_HEIGHT;
      const colWidth = CONTENT_W / Math.max(block.header.length, 1);
      // Top rule
      doc.setLineWidth(1);
      doc.line(MARGIN, y - 4, PAGE_W - MARGIN, y - 4);
      // Header row
      doc.setFont("times", "bold");
      block.header.forEach((c, i) => {
        const wrapped = doc.splitTextToSize(c, colWidth - 6) as string[];
        doc.text(wrapped[0] ?? c, MARGIN + i * colWidth + 3, y);
      });
      y += LINE_HEIGHT * 0.8;
      // Mid rule
      doc.line(MARGIN, y - 4, PAGE_W - MARGIN, y - 4);
      doc.setFont("times", "normal");
      for (const row of block.rows) {
        ensure(LINE_HEIGHT);
        row.forEach((c, i) => {
          const wrapped = doc.splitTextToSize(String(c), colWidth - 6) as string[];
          doc.text(wrapped[0] ?? String(c), MARGIN + i * colWidth + 3, y);
        });
        y += LINE_HEIGHT * 0.9;
      }
      // Bottom rule
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 16;
      continue;
    }

    if (block.type === "figureplaceholder") {
      figureCounter++;
      const fig = figures?.[block.index];
      ensure(200);
      y += 12;
      if (fig) {
        const imgH = 180;
        const imgW = Math.min(CONTENT_W, 320);
        const imgX = MARGIN + (CONTENT_W - imgW) / 2;
        doc.addImage(`data:${fig.mediaType};base64,${fig.base64}`, "JPEG", imgX, y, imgW, imgH);
        y += imgH + 8;
      } else {
        doc.setFont("times", "italic");
        doc.setFontSize(11);
        doc.text(`[Figure ${figureCounter} — image not available]`, PAGE_W / 2, y, { align: "center" });
        y += LINE_HEIGHT;
      }
      // Figure label + caption
      doc.setFont("times", "italic");
      doc.setFontSize(BODY_SIZE);
      const capText = `Figure ${figureCounter}${block.caption ? `  ${block.caption}` : ""}`;
      const capLines = doc.splitTextToSize(capText, CONTENT_W) as string[];
      for (const line of capLines) {
        ensure(LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT * 0.9;
      }
      y += 12;
      continue;
    }

    doc.setFont("times", "normal");
    doc.setFontSize(BODY_SIZE);

    if (block.type === "list") {
      for (let idx = 0; idx < block.items.length; idx++) {
        const prefix = block.ordered ? `${idx + 1}. ` : "• ";
        const wrapped = doc.splitTextToSize(prefix + block.items[idx], CONTENT_W - INDENT) as string[];
        for (let li = 0; li < wrapped.length; li++) {
          ensure(LINE_HEIGHT);
          doc.text(wrapped[li], li === 0 ? MARGIN : MARGIN + INDENT, y);
          y += LINE_HEIGHT;
        }
      }
      continue;
    }

    if (block.type === "blockquote") {
      const wrapped = doc.splitTextToSize(block.text, CONTENT_W - HANG * 2) as string[];
      for (const w of wrapped) {
        ensure(LINE_HEIGHT);
        doc.text(w, MARGIN + HANG, y);
        y += LINE_HEIGHT;
      }
      y += 8;
      continue;
    }

    // Regular paragraph
    for (const line of block.text.split("\n").filter(Boolean)) {
      if (inReferencesSection) {
        // Hanging indent: first line at margin, continuation indented
        const wrapped = doc.splitTextToSize(line, CONTENT_W - HANG) as string[];
        for (let li = 0; li < wrapped.length; li++) {
          ensure(LINE_HEIGHT);
          doc.text(wrapped[li], li === 0 ? MARGIN : MARGIN + HANG, y);
          y += LINE_HEIGHT;
        }
      } else {
        // First-line indent
        const wrapped = doc.splitTextToSize(line, CONTENT_W - INDENT) as string[];
        for (let li = 0; li < wrapped.length; li++) {
          ensure(LINE_HEIGHT);
          doc.text(wrapped[li], li === 0 ? MARGIN + INDENT : MARGIN, y);
          y += LINE_HEIGHT;
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
