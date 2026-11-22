/**
 * Deterministic number parser for OCR'd text such as
 *   "10.000", "10,000", "15 000 km", "1.2K", "3,5k", "2M", "R$ 300", "—".
 * Returns null when the text is empty/unreadable — never guesses.
 */
export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input).trim().toLowerCase();
  if (!s || /^[-–—?._\s]+$/.test(s) || s === "n/a" || s === "null") return null;

  // remove units / currency / spaces
  s = s.replace(/kms?|robux|rbx|r\$|donated|donate/g, "");
  s = s.replace(/[\s $€£¥]/g, "");
  // any other unexpected character (e.g. "1,2?0", "1O0") means the value was not read reliably
  if (/[^\d.,kmb+-]/.test(s)) return null;

  let mult = 1;
  const suffix = s.match(/([kmb])\+?$/);
  if (suffix) {
    mult = suffix[1] === "k" ? 1e3 : suffix[1] === "m" ? 1e6 : 1e9;
    s = s.slice(0, s.length - suffix[0].length);
  }
  s = s.replace(/\+$/, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let normalized: string;

  if (dots && commas) {
    // the last separator is the decimal one
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    normalized = s.split(thou).join("").replace(dec, ".");
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const count = dots || commas;
    const parts = s.split(sep);
    const groupsOf3 = parts.slice(1).every((p) => p.length === 3);
    if (count > 1) {
      // 1.234.567 → thousands separators
      normalized = groupsOf3 ? parts.join("") : NaN.toString();
    } else if (mult > 1) {
      // with K/M suffix a single separator is decimal: 1.2K, 3,5k
      normalized = parts.join(".");
    } else {
      // single separator without suffix: "10.000" / "10,000" are thousands; "12.5" decimal
      normalized = groupsOf3 ? parts.join("") : parts.join(".");
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult * 100) / 100;
}

export function parseInteger(input: unknown): number | null {
  const n = parseNumber(input);
  return n === null ? null : Math.round(n);
}

/** Normalise a Roblox username for identity comparison. */
export function usernameKey(u: string): string {
  return u.trim().replace(/^@/, "").toLowerCase();
}

/** Clean a username as displayed: strip leading @ and whitespace. */
export function cleanUsername(u: string): string {
  return u.trim().replace(/^@/, "").replace(/\s+/g, "");
}

/** Levenshtein distance (small strings) for "did you mean" suggestions on OCR typos. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
