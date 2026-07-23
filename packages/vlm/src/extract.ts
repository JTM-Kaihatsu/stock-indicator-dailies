/**
 * Pull a JSON value out of raw model text. Models often wrap JSON in ```json
 * fences or add a sentence of prose around it, so we try, in order:
 *   1. the contents of the first fenced code block,
 *   2. the whole trimmed string,
 *   3. the substring from the first `{` to the last `}`.
 * Returns the parsed value, or `null` if nothing parses.
 */
export function extractJson(raw: string): unknown | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;

  const candidates: string[] = [];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  candidates.push(text);

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}
