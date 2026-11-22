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
