import { codeExecutionAvailable, createRawAnthropic } from "./ai-gateway.server";

const SANDBOX_EXTS = new Set(["pdf", "xlsx", "xls"]);

/**
 * Runs an uploaded PDF/Excel file through the Anthropic code-execution sandbox (pandas /
 * openpyxl / pdfplumber) instead of mammoth/unpdf, so multi-sheet workbooks and tables embedded
 * in PDFs come back as real structured text instead of a flattened text dump. Returns null when
 * the sandbox isn't configured or the file type doesn't benefit from it — callers should fall
 * back to the plain-text extractor in that case.
 */
export async function extractWithSandbox(base64: string, filename: string): Promise<string | null> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (!SANDBOX_EXTS.has(ext) || !codeExecutionAvailable()) return null;

  const client = await createRawAnthropic();
  const bytes = Buffer.from(base64, "base64");

  const uploaded = await client.beta.files.upload({
    file: await toAnthropicFile(bytes, filename),
    betas: ["files-api-2025-04-14"],
  });

  const isPdf = ext === "pdf";
  const instructions = isPdf
    ? "It's a PDF. Use pdfplumber to extract the full text AND every table on every page (render tables as markdown tables, in page order, interleaved with the surrounding text)."
    : "It's an Excel workbook. Use openpyxl/pandas to read EVERY sheet and print each sheet's name followed by its full contents as a markdown table.";

  const response = await client.beta.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    betas: ["files-api-2025-04-14", "code-execution-2025-08-25"],
    tools: [{ type: "code_execution_20250825", name: "code_execution" }],
    messages: [
      {
        role: "user",
        content: [
          { type: "container_upload", file_id: uploaded.id },
          {
            type: "text",
            text: `Extract the complete content of the attached file "${filename}" for downstream analysis. ${instructions} Print ONLY the extracted content (no commentary, no code in your final answer) — that printed output is the only thing I'll use.`,
          },
        ],
      },
    ],
  });

  const pieces: string[] = [];
  for (const block of response.content) {
    if (block.type === "bash_code_execution_tool_result" && "stdout" in block.content) {
      pieces.push(block.content.stdout);
    }
    if (block.type === "text") pieces.push(block.text);
  }

  const text = pieces.join("\n").trim();
  return text.length > 0 ? text : null;
}

async function toAnthropicFile(bytes: Buffer, filename: string) {
  const { toFile } = await import("@anthropic-ai/sdk");
  const mime =
    filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return toFile(bytes, filename, { type: mime });
}
