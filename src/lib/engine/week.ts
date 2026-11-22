import type { GeneralSettings } from "./types";

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(ms: number, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Offset (ms) of `tz` relative to UTC at instant `ms`. */
function tzOffset(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / 60000) * 60000;
}

/** Convert a wall-clock time in `tz` to a UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  let result = guess - tzOffset(guess, tz);
  const second = guess - tzOffset(result, tz);
  if (second !== result) result = second;
  return result;
}

/** The most recent weekly-reset instant at or before `ms`. */
export function lastWeeklyReset(ms: number, s: Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">): number {
  const p = localParts(ms, s.timezone);
  let daysBack = (p.weekday - s.week_reset_weekday + 7) % 7;
  if (daysBack === 0 && p.hour < s.week_reset_hour) daysBack = 7;
  // compute the local calendar date `daysBack` days earlier (UTC arithmetic on a date-only value is safe)
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), s.week_reset_hour, s.timezone);
}

/** True when a weekly reset happened in (a, b]. */
export function crossesWeeklyReset(
  aMs: number,
  bMs: number,
  s: Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">,
): boolean {
  if (bMs <= aMs) return false;
  return lastWeeklyReset(bMs, s) > aMs;
}

export const WEEK_MS = 7 * 86_400_000;

export interface ResetPoint {
  /** capture time (ms) */
  ms: number;
  /** next weekly reset read from the in-game countdown on that screenshot (ISO), if known */
  next_reset_at?: string | null;
}

/**
 * Did a weekly reset happen in (a, b]?
 * Uses the countdown read from the screenshots first (exact), and only falls back to the
 * configured weekday/hour when neither snapshot has a countdown.
 */
export function resetBetween(
  a: ResetPoint,
  b: ResetPoint,
  s: Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">,
): boolean {
  if (b.ms <= a.ms) return false;
  if (a.next_reset_at) {
    // a's countdown tells exactly when the next reset after a happens
    return new Date(a.next_reset_at).getTime() <= b.ms;
  }
  if (b.next_reset_at) {
    // the reset before b happened one week before b's next reset
    return new Date(b.next_reset_at).getTime() - WEEK_MS > a.ms;
  }
  return crossesWeeklyReset(a.ms, b.ms, s);
}

/**
 * Parse an in-game countdown such as "2d 5h 30m", "6 days 04:12:33", "04:12:33",
 * "1 ngày 3 giờ 20 phút", "5D 12H". Returns seconds, or null when unreadable.
 */
export function parseCountdown(input: string | null | undefined): number | null {
  if (!input) return null;
  let s = input.toLowerCase().replace(/resets?\s*(in)?|reset|còn lại|còn|in\b|:\s*$/g, " ").trim();
  if (!s) return null;
  let total = 0;
  let found = false;

  const unit = (re: RegExp, mult: number) => {
    s = s.replace(re, (_m, n: string) => {
      total += Number(n) * mult;
      found = true;
      return " ";
    });
  };
  unit(/(\d+)\s*(?:days?|ngày|d)(?![a-z])/g, 86400);
  // colon clock part: h:m:s or h:m
  const clock = s.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    const [, h, m, sec] = clock;
    if (Number(m) > 59 || (sec && Number(sec) > 59)) return null;
    total += Number(h) * 3600 + Number(m) * 60 + (sec ? Number(sec) : 0);
    found = true;
    s = s.replace(clock[0], " ");
  }
  unit(/(\d+)\s*(?:hours?|hrs?|giờ|tiếng|h)(?![a-z])/g, 3600);
  unit(/(\d+)\s*(?:minutes?|mins?|phút|m)(?![a-z])/g, 60);
  unit(/(\d+)\s*(?:seconds?|secs?|giây|s)(?![a-z])/g, 1);

  // anything numeric left over means we didn't understand the format
  if (!found || /\d/.test(s)) return null;
  if (total < 0 || total > WEEK_MS / 1000 + 3600) return null;
  return total;
}
