// Matches http(s) URLs up to the next whitespace run. Trailing punctuation
// that's almost never part of the URL itself (sentence-ending punctuation,
// and a lone closing paren when there's no matching opening paren) is
// trimmed by trimTrailingPunctuation() below rather than in the regex, so
// URLs containing balanced parens — e.g. Wikipedia links — survive intact.
const URL_RE = /https?:\/\/\S+/g;

function trimTrailingPunctuation(candidate: string): string {
  let s = candidate.replace(/[.,;:!?]+$/, "");
  if (s.endsWith(")") && !s.includes("(")) {
    s = s.slice(0, -1);
  }
  return s;
}

/** Extract http/https URLs from message text, in order. Non-http schemes (javascript:, ftp:, data:) must be ignored. */
export function extractHttpUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  const urls: string[] = [];
  for (const raw of matches) {
    const trimmed = trimTrailingPunctuation(raw);
    try {
      // new URL() both validates and normalizes; also re-confirms the
      // scheme since trimming could theoretically shift things.
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(trimmed);
      }
    } catch {
      // Not a valid URL once trimmed — skip it.
    }
  }
  return urls;
}

/** Split text into segments so the UI can linkify: [{type:"text",value},{type:"url",value},...]. Adjacent text preserved verbatim; whole input round-trips by concatenating values. */
export function splitByUrls(text: string): Array<{ type: "text" | "url"; value: string }> {
  const urls = extractHttpUrls(text);
  const segments: Array<{ type: "text" | "url"; value: string }> = [];
  let cursor = 0;
  for (const url of urls) {
    const idx = text.indexOf(url, cursor);
    if (idx === -1) continue; // shouldn't happen, but keep round-trip safety
    if (idx > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, idx) });
    }
    segments.push({ type: "url", value: url });
    cursor = idx + url.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}
