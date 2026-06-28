export const STREAM_ERROR_MARKER = " __STREAM_ERROR__ ";

/** Appended (with no payload after it) when generation stops because it hit the
 *  output-token cap rather than finishing naturally — lets the client offer a
 *  "Continue" action instead of silently presenting a cut-off response as final. */
export const STREAM_TRUNCATED_MARKER = " __STREAM_TRUNCATED__ ";

export function splitStreamError(raw: string): { text: string; error?: string } {
  const idx = raw.indexOf(STREAM_ERROR_MARKER);
  if (idx === -1) return { text: raw };
  return { text: raw.slice(0, idx), error: raw.slice(idx + STREAM_ERROR_MARKER.length).trim() };
}

export function splitStreamTruncated(raw: string): { text: string; truncated: boolean } {
  const idx = raw.indexOf(STREAM_TRUNCATED_MARKER);
  if (idx === -1) return { text: raw, truncated: false };
  return { text: raw.slice(0, idx), truncated: true };
}
