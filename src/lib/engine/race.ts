import type { DonateType, GeneralSettings } from "./types";
import { lastWeeklyReset, WEEK_MS } from "./week";

/**
 * The weekly race the crew is currently in.
 * Uses the reset time read from the in-game countdown (exact) and rolls it forward week by week;
 * falls back to the weekday/hour in Settings when no screenshot had a countdown.
 */
export function currentRaceWeek(
  nowMs: number,
  knownNextResetAt: string | null,
  s: Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">,
): { start: number; end: number; fromCountdown: boolean } {
  if (knownNextResetAt) {
    const r = new Date(knownNextResetAt).getTime();
    // shift the known reset by whole weeks so that start <= now < end
    const k = Math.floor((nowMs - r) / WEEK_MS);
    const start = r + k * WEEK_MS;
    return { start, end: start + WEEK_MS, fromCountdown: true };
  }
  const start = lastWeeklyReset(nowMs, s);
  return { start, end: start + WEEK_MS, fromCountdown: false };
}

export interface ContributionPoint {
  captured_at: string;
  weekly_km: number | null;
  donated: number | null;
  donate_type: DonateType;
}

export interface WeekContribution {
  /** KM in the current race week (0 if no screenshot since the reset yet) */
  km: number | null;
  /** Donate in the current race week; null when there is no reference point before the week started */
  donate: number | null;
  /** donate is approximate (reference snapshot was taken a while before the reset) */
  donateApprox: boolean;
  /** cumulative Donated as last read (for information) */
  donatedTotal: number | null;
  /** true when the member has no screenshot in the current week yet → values are the new-week default 0 */
  newWeekNoData: boolean;
  lastAt: string | null;
}

/** What a member has contributed in the current race week. `points` = verified values, any order. */
export function weekContribution(points: ContributionPoint[], weekStart: number): WeekContribution {
  const sorted = [...points].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const last = sorted[sorted.length - 1];
  if (!last) return { km: null, donate: null, donateApprox: false, donatedTotal: null, newWeekNoData: false, lastAt: null };

  const t = (p: ContributionPoint) => new Date(p.captured_at).getTime();
  if (t(last) < weekStart) {
    // a new week started after the latest screenshot: the race restarts from 0
    return { km: 0, donate: 0, donateApprox: false, donatedTotal: last.donated, newWeekNoData: true, lastAt: last.captured_at };
  }

  let donate: number | null = null;
  let donateApprox = false;
  if (last.donated !== null) {
    if (last.donate_type === "weekly") donate = last.donated;
    else {
      // cumulative counter: subtract the last value seen before the week started
      const before = [...sorted].reverse().find((p) => t(p) < weekStart && p.donated !== null && p.donate_type === "cumulative");
      if (before) {
        donate = Math.max(0, last.donated - before.donated!);
        // if the reference was taken more than 6h before the reset, some of it may belong to last week
        donateApprox = weekStart - t(before) > 6 * 3600_000;
      }
    }
  }
  return { km: last.weekly_km, donate, donateApprox, donatedTotal: last.donated, newWeekNoData: false, lastAt: last.captured_at };
}
