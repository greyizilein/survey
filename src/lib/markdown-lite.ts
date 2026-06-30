// Minimal markdown parsing shared between chat rendering, clean-copy, and
// document export — keeps all three in sync on what counts as a heading/table/paragraph.

export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "figureplaceholder"; index: number; caption?: string }
  | { type: "paragraph"; text: string };

export function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

export const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

const UNORDERED_LIST_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_LIST_RE = /^(\s*)\d+[.)]\s+(.*)$/;

export function parseMarkdownLite(text: string, figureOffset = 0): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let paragraphBuf: string[] = [];
  let figureCount = figureOffset;

  function flushParagraph() {
    if (paragraphBuf.length) {
      blocks.push({ type: "paragraph", text: paragraphBuf.join("\n") });
      paragraphBuf = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Figure placeholder — @@FIGURE@@{json} becomes an inline figure slot
    if (line.startsWith("@@FIGURE@@")) {
      flushParagraph();
      let caption: string | undefined;
      try {
        const parsed = JSON.parse(line.slice("@@FIGURE@@".length));
        caption = parsed?.caption;
      } catch {
        /* still streaming or malformed */
      }
      blocks.push({ type: "figureplaceholder", index: figureCount, caption });
      figureCount++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }

    // Table
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

    // Blockquote
    if (/^>\s*/.test(line)) {
      flushParagraph();
      const bqText = line.replace(/^>\s*/, "");
      // Collect consecutive blockquote lines
      const bqLines = [bqText];
      while (i + 1 < lines.length && /^>\s*/.test(lines[i + 1])) {
        i++;
        bqLines.push(lines[i].replace(/^>\s*/, ""));
      }
      blocks.push({ type: "blockquote", text: bqLines.join("\n") });
      continue;
    }

    // Unordered list
    const ulMatch = UNORDERED_LIST_RE.exec(line);
    if (ulMatch) {
      flushParagraph();
      const items: string[] = [ulMatch[2]];
      while (i + 1 < lines.length && UNORDERED_LIST_RE.test(lines[i + 1])) {
        i++;
        const m = UNORDERED_LIST_RE.exec(lines[i])!;
        items.push(m[2]);
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    const olMatch = ORDERED_LIST_RE.exec(line);
    if (olMatch) {
      flushParagraph();
      const items: string[] = [olMatch[2]];
      while (i + 1 < lines.length && ORDERED_LIST_RE.test(lines[i + 1])) {
        i++;
        const m = ORDERED_LIST_RE.exec(lines[i])!;
        items.push(m[2]);
      }
      blocks.push({ type: "list", ordered: true, items });
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

// Splits inline text on **bold** and *italic* markers into plain/bold/italic runs,
// for renderers that need to apply emphasis without keeping the raw markdown characters.
export function splitInlineRuns(text: string): { text: string; bold: boolean; italic: boolean }[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p !== "");
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) return { text: part.slice(2, -2), bold: true, italic: false };
    if (part.startsWith("*") && part.endsWith("*")) return { text: part.slice(1, -1), bold: false, italic: true };
    return { text: part, bold: false, italic: false };
  });
}

export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToHtml(text: string): string {
  return splitInlineRuns(text)
    .map((run) => {
      const escaped = escapeHtml(run.text);
      if (run.bold) return `<strong>${escaped}</strong>`;
      if (run.italic) return `<em>${escaped}</em>`;
      return escaped;
    })
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
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join("");
        return `<${tag}>${items}</${tag}>`;
      }
      if (block.type === "blockquote") {
        return `<blockquote>${inlineToHtml(block.text).replace(/\n/g, "<br/>")}</blockquote>`;
      }
      if (block.type === "figureplaceholder") {
        // When exported to HTML without embedded image data, render a labelled placeholder
        const label = block.caption ? escapeHtml(block.caption) : `Figure ${block.index + 1}`;
        return `<p style="border:1px dashed #aaa;padding:8px;text-align:center">[${label}]</p>`;
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
      if (block.type === "list") {
        return block.items
          .map((item, i) => (block.ordered ? `${i + 1}. ${stripInlineMarkdown(item)}` : `• ${stripInlineMarkdown(item)}`))
          .join("\n");
      }
      if (block.type === "blockquote") {
        return stripInlineMarkdown(block.text);
      }
      if (block.type === "figureplaceholder") {
        return block.caption ? `[Figure: ${block.caption}]` : `[Figure ${block.index + 1}]`;
      }
      return stripInlineMarkdown(block.text);
    })
    .join("\n\n");
}
