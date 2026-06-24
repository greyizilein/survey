// Minimal markdown parsing shared between chat rendering, clean-copy, and
// document export — keeps all three in sync on what counts as a heading/table/paragraph.

export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "paragraph"; text: string };

export function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

export const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export function parseMarkdownLite(text: string): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let paragraphBuf: string[] = [];

  function flushParagraph() {
    if (paragraphBuf.length) {
      blocks.push({ type: "paragraph", text: paragraphBuf.join("\n") });
      paragraphBuf = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      blocks.push({ type: "table", header, rows });
      i = j - 1;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraphBuf.push(line);
  }
  flushParagraph();
  return blocks;
}

// Splits inline text on **bold** markers into plain/bold runs, for renderers
// that need to apply emphasis without keeping the raw markdown characters.
export function splitInlineRuns(text: string): { text: string; bold: boolean }[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  return parts.map((part) =>
    part.startsWith("**") && part.endsWith("**")
      ? { text: part.slice(2, -2), bold: true }
      : { text: part, bold: false },
  );
}

export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToHtml(text: string): string {
  return splitInlineRuns(text)
    .map((run) => (run.bold ? `<strong>${escapeHtml(run.text)}</strong>` : escapeHtml(run.text)))
    .join("");
}

// Renders parsed blocks as a clipboard-friendly HTML fragment (used for
// rich-text copy so pasted content keeps bold/headings/tables, not raw **).
export function blocksToHtml(blocks: MdBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        const level = Math.min(Math.max(block.level, 1), 4);
        return `<h${level}>${inlineToHtml(block.text)}</h${level}>`;
      }
      if (block.type === "table") {
        const head = `<tr>${block.header.map((c) => `<th>${inlineToHtml(c)}</th>`).join("")}</tr>`;
        const rows = block.rows
          .map((row) => `<tr>${row.map((c) => `<td>${inlineToHtml(c)}</td>`).join("")}</tr>`)
          .join("");
        return `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse">${head}${rows}</table>`;
      }
      return `<p>${inlineToHtml(block.text).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
}

// Renders parsed blocks as clean plain text (markdown markers stripped) for
// the text/plain clipboard fallback.
export function blocksToPlainText(blocks: MdBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") return stripInlineMarkdown(block.text);
      if (block.type === "table") {
        return [block.header.join("\t"), ...block.rows.map((row) => row.join("\t"))].join("\n");
      }
      return stripInlineMarkdown(block.text);
    })
    .join("\n\n");
}
