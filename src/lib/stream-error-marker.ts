export const STREAM_ERROR_MARKER = " __STREAM_ERROR__ ";

export function splitStreamError(raw: string): { text: string; error?: string } {
  const idx = raw.indexOf(STREAM_ERROR_MARKER);
  if (idx === -1) return { text: raw };
  return { text: raw.slice(0, idx), error: raw.slice(idx + STREAM_ERROR_MARKER.length).trim() };
}
