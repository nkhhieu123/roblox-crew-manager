import { describe, expect, it } from "vitest";
import { parseNumber, levenshtein } from "./parse";
import { crossesWeeklyReset, lastWeeklyReset, parseCountdown, resetBetween } from "./week";
import { dayPeriodAt, evaluateMember, evaluateMemberDaily } from "./evaluate";
import { currentRaceWeek, weekContribution } from "./race";
import { DEFAULT_REQUIREMENT, DEFAULT_SETTINGS, type DataPoint, type RequirementConfig } from "./types";

const S = { ...DEFAULT_SETTINGS, timezone: "Asia/Ho_Chi_Minh", week_reset_weekday: 1, week_reset_hour: 0 };
const ANY: RequirementConfig = { ...DEFAULT_REQUIREMENT, mode: "ANY", min_km: 5000, min_donate: 100, warning_pct: 0 };

function pt(id: string, iso: string, km: number | null, donated: number | null, donate_type: "cumulative" | "weekly" = "cumulative"): DataPoint {
  return { snapshot_id: id, captured_at: iso, weekly_km: km, donated, donate_type };
}

describe("parseNumber", () => {
  it.each([
    ["10.000", 10000],
    ["10,000", 10000],
    ["15 000 km", 15000],
    ["1.234.567", 1234567],
    ["1.2K", 1200],
    ["3,5k", 3500],
    ["2M", 2000000],
    ["12.5", 12.5],
    ["R$ 300", 300],
    ["1,234.5", 1234.5],
    ["0", 0],
  ])("%s → %d", (input, expected) => expect(parseNumber(input)).toBe(expected));

  it.each(["", "—", "?", "n/a", null, undefined, "abc"])("unreadable %s → null", (input) =>
    expect(parseNumber(input)).toBeNull(),
  );
});

describe("levenshtein", () => {
  it("detects close usernames", () => {
    expect(levenshtein("player123", "playerl23")).toBe(1);
  });
});

describe("weekly reset", () => {
  it("finds Monday 00:00 Asia/Ho_Chi_Minh (= Sunday 17:00 UTC)", () => {
    const wed = Date.parse("2026-11-04T10:00:00Z"); // Wednesday
    expect(new Date(lastWeeklyReset(wed, S)).toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });
  it("detects crossing", () => {
    expect(crossesWeeklyReset(Date.parse("2026-11-01T12:00:00Z"), Date.parse("2026-11-02T12:00:00Z"), S)).toBe(true);
    expect(crossesWeeklyReset(Date.parse("2026-11-02T12:00:00Z"), Date.parse("2026-11-03T12:00:00Z"), S)).toBe(false);
  });
});

describe("evaluateMember — spec example", () => {
  // Lần 1: 08:00 03/11 — KM 10.000, Donate 100. Lần 2: 08:00 04/11 — KM 15.000, Donate 300 (same week)
  const points = [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 15000, 300)];

  it("computes deltas by subtracting snapshots", () => {
    const r = evaluateMember(points, "s2", ANY, S);
    expect(r.km).toEqual({ value: 5000, exact: true, flags: [] });
    expect(r.donate.value).toBe(200);
    expect(r.hours).toBe(24);
    expect(r.km_per_day).toBe(5000);
    expect(r.status).toBe("PASS");
  });

  it("ALL mode needs both", () => {
    const r = evaluateMember(points, "s2", { ...ANY, mode: "ALL", min_donate: 500 }, S);
    expect(r.status).toBe("FAIL");
    expect(r.reason_summary).toBe("Không đạt mức Donate tối thiểu");
  });
});

describe("evaluateMember — statuses", () => {
  it("FAIL with explicit reason when both conditions missed", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 11000, 100)],
      "s2",
      ANY,
      S,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reason_summary).toBe("Không đạt cả hai điều kiện");
    expect(r.km_required).toBe(5000);
  });

  it("WARNING when close to requirement", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 14500, 100)],
      "s2",
      { ...ANY, warning_pct: 80 },
      S,
    );
    expect(r.status).toBe("WARNING");
  });

  it("PASS on donate alone in ANY mode", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 10000, 250)],
      "s2",
      ANY,
      S,
    );
    expect(r.status).toBe("PASS");
  });

  it("PENDING when there is no baseline old enough", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T20:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 10000, 100)],
      "s2",
      ANY,
      S,
    );
    expect(r.status).toBe("PENDING");
    expect(r.flags).toContain("no_baseline");
  });

  it("PENDING (not FAIL) when the member is missing from the target snapshot", () => {
    const r = evaluateMember([pt("s1", "2026-11-03T01:00:00Z", 10000, 100)], "s2", ANY, S);
    expect(r.status).toBe("PENDING");
    expect(r.flags).toContain("no_new_data");
  });

  it("PENDING when KM unreadable and donate fails in ANY mode", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", null, 120)],
      "s2",
      ANY,
      S,
    );
    expect(r.status).toBe("PENDING");
    expect(r.km.value).toBeNull();
  });

  it("EXEMPT keeps gains for information", () => {
    const r = evaluateMember(
      [pt("s1", "2026-11-03T01:00:00Z", 10000, 100), pt("s2", "2026-11-04T01:00:00Z", 10000, 100)],
      "s2",
      ANY,
      S,
      { exempt: true },
    );
    expect(r.status).toBe("EXEMPT");
    expect(r.km.value).toBe(0);
  });
});

describe("evaluateMember — weekly KM reset", () => {
  // Sunday 20:00 VN → Monday 20:00 VN, reset at Monday 00:00 VN
  const sun = "2026-11-01T13:00:00Z";
  const mon = "2026-11-02T13:00:00Z";

  it("never concludes FAIL when KM reset crossed and lower bound is below threshold", () => {
    const r = evaluateMember([pt("a", sun, 30000, null), pt("b", mon, 2000, null)], "b", { ...ANY, use_donate: false }, S);
    expect(r.km).toEqual({ value: 2000, exact: false, flags: ["weekly_reset"] });
    expect(r.status).toBe("PENDING");
  });

  it("PASS when the post-reset value alone satisfies the requirement", () => {
    const r = evaluateMember([pt("a", sun, 30000, null), pt("b", mon, 6000, null)], "b", { ...ANY, use_donate: false }, S);
    expect(r.status).toBe("PASS");
  });

  it("uses intermediate snapshots to stay exact around the reset", () => {
    // snapshot right before the reset and right after
    const r = evaluateMember(
      [pt("a", sun, 30000, null), pt("m", "2026-11-01T16:30:00Z", 31000, null), pt("n", "2026-11-01T17:30:00Z", 0, null), pt("b", mon, 2000, null)],
      "b",
      { ...ANY, use_donate: false },
      { ...S, baseline_tolerance_pct: 0 },
    );
    expect(r.from_snapshot_id).toBe("a");
    // 30000→31000 (+1000), reset between m and n: +0 (lower bound), n→b +2000 => 3000, inexact
    expect(r.km.value).toBe(3000);
    expect(r.km.exact).toBe(false);
  });

  it("flags unexpected KM decrease without a reset", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 9000, null), pt("b", "2026-11-04T01:00:00Z", 3000, null)],
      "b",
      { ...ANY, use_donate: false },
      S,
    );
    expect(r.km.flags).toContain("km_decreased");
    expect(r.status).toBe("PENDING");
  });
});

describe("evaluateMember — donate types", () => {
  it("cumulative donate decrease is flagged, not counted as activity", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 0, 500), pt("b", "2026-11-04T01:00:00Z", 0, 300)],
      "b",
      { ...ANY, use_km: false },
      S,
    );
    expect(r.donate.flags).toContain("donate_decreased");
    expect(r.status).toBe("PENDING");
  });

  it("weekly donate follows reset logic", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-01T13:00:00Z", null, 400, "weekly"), pt("b", "2026-11-02T13:00:00Z", null, 150, "weekly")],
      "b",
      { ...ANY, use_km: false },
      S,
    );
    expect(r.donate).toEqual({ value: 150, exact: false, flags: ["donate_weekly_reset"] });
    expect(r.status).toBe("PASS");
  });

  it("mixed donate types are not compared", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 0, 400, "cumulative"), pt("b", "2026-11-04T01:00:00Z", 0, 150, "weekly")],
      "b",
      { ...ANY, use_km: false },
      S,
    );
    expect(r.donate.value).toBeNull();
    expect(r.status).toBe("PENDING");
  });
});

describe("evaluateMember — custom & scaling", () => {
  const custom: RequirementConfig = { ...DEFAULT_REQUIREMENT, mode: "CUSTOM", warning_pct: 0 };
  // (KM >= 5000 AND Donate >= 100) OR KM >= 10000

  it("passes via the OR branch", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 0, 0), pt("b", "2026-11-04T01:00:00Z", 12000, 0)],
      "b",
      custom,
      S,
    );
    expect(r.status).toBe("PASS");
  });

  it("fails both branches", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 0, 0), pt("b", "2026-11-04T01:00:00Z", 6000, 50)],
      "b",
      custom,
      S,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reason_summary).toBe("Không thỏa điều kiện tùy chỉnh");
  });

  it("scales the requirement when the interval is much longer than the window", () => {
    const r = evaluateMember(
      [pt("a", "2026-11-03T01:00:00Z", 0, 0), pt("b", "2026-11-05T01:00:00Z", 8000, 0)],
      "b",
      { ...ANY, use_donate: false },
      S,
    );
    expect(r.hours).toBe(48);
    expect(r.km_required).toBe(10000);
    expect(r.status).toBe("FAIL");
    expect(r.flags).toContain("window_longer");
  });

  it("picks the newest baseline at or before the window", () => {
    const r = evaluateMember(
      [
        pt("a", "2026-11-02T01:00:00Z", 0, 0),
        pt("b", "2026-11-03T01:00:00Z", 1000, 0),
        pt("c", "2026-11-03T13:00:00Z", 3000, 0),
        pt("d", "2026-11-04T01:00:00Z", 7000, 0),
      ],
      "d",
      { ...ANY, use_donate: false },
      S,
    );
    expect(r.from_snapshot_id).toBe("b");
    expect(r.km.value).toBe(6000);
  });
});

describe("countdown-based weekly reset", () => {
  it.each([
    ["Resets in 2d 05:12:33", 2 * 86400 + 5 * 3600 + 12 * 60 + 33],
    ["2d 5h 30m", 2 * 86400 + 5 * 3600 + 30 * 60],
    ["04:12:33", 4 * 3600 + 12 * 60 + 33],
    ["1 ngày 3 giờ 20 phút", 86400 + 3 * 3600 + 20 * 60],
    ["5D 12H", 5 * 86400 + 12 * 3600],
    ["6 days 23:59", 6 * 86400 + 23 * 3600 + 59 * 60],
  ])("parses %s", (text, secs) => expect(parseCountdown(text)).toBe(secs));

  it.each(["", "soon", "2d 5x", "9d 00:00:00", "12:75"])("rejects %s", (text) => expect(parseCountdown(text)).toBeNull());

  const S2 = { ...S }; // settings say Monday 00:00 VN, but the game actually resets Thursday 20:00 VN
  it("uses the countdown instead of the configured weekday", () => {
    // Thu 2026-11-19 10:00 VN, countdown 10h → reset Thu 20:00 VN (13:00Z)
    const a = { ms: Date.parse("2026-11-19T03:00:00Z"), next_reset_at: "2026-11-19T13:00:00Z" };
    const b = { ms: Date.parse("2026-11-20T03:00:00Z"), next_reset_at: "2026-11-26T13:00:00Z" };
    expect(resetBetween(a, b, S2)).toBe(true);
    // Sunday → Monday crosses the configured reset but NOT the real one → no reset
    const c = { ms: Date.parse("2026-11-22T03:00:00Z"), next_reset_at: "2026-11-26T13:00:00Z" };
    const d = { ms: Date.parse("2026-11-23T03:00:00Z"), next_reset_at: "2026-11-26T13:00:00Z" };
    expect(resetBetween(c, d, S2)).toBe(false);
  });

  it("works when only the later snapshot has a countdown", () => {
    const a = { ms: Date.parse("2026-11-19T03:00:00Z"), next_reset_at: null };
    const b = { ms: Date.parse("2026-11-20T03:00:00Z"), next_reset_at: "2026-11-26T13:00:00Z" };
    expect(resetBetween(a, b, S2)).toBe(true); // previous reset 2026-11-19T13:00Z is after a
  });

  it("gives exact KM gain when no reset happened even across the configured Monday", () => {
    const r = evaluateMember(
      [
        { snapshot_id: "a", captured_at: "2026-11-22T03:00:00Z", weekly_km: 20000, donated: null, donate_type: "cumulative", next_reset_at: "2026-11-26T13:00:00Z" },
        { snapshot_id: "b", captured_at: "2026-11-23T03:00:00Z", weekly_km: 26000, donated: null, donate_type: "cumulative", next_reset_at: "2026-11-26T13:00:00Z" },
      ],
      "b",
      { ...ANY, use_donate: false },
      S2,
    );
    expect(r.km).toEqual({ value: 6000, exact: true, flags: [] });
    expect(r.status).toBe("PASS");
  });
});

describe("weekly race", () => {
  // reset read from screenshot: 2026-11-23T07:33Z
  const R = "2026-11-23T07:33:00Z";
  it("finds the current race week from the countdown and rolls it forward", () => {
    const w1 = currentRaceWeek(Date.parse("2026-11-22T10:00:00Z"), R, S);
    expect(new Date(w1.end).toISOString()).toBe("2026-11-23T07:33:00.000Z");
    const w2 = currentRaceWeek(Date.parse("2026-11-25T10:00:00Z"), R, S);
    expect(new Date(w2.start).toISOString()).toBe("2026-11-23T07:33:00.000Z");
    const w3 = currentRaceWeek(Date.parse("2026-12-05T10:00:00Z"), R, S);
    expect(new Date(w3.start).toISOString()).toBe("2026-11-30T07:33:00.000Z");
  });

  const p = (at: string, km: number | null, don: number | null) => ({ captured_at: at, weekly_km: km, donated: don, donate_type: "cumulative" as const });

  it("resets to 0 when the week rolled over and there is no new screenshot yet", () => {
    const start = Date.parse(R);
    const c = weekContribution([p("2026-11-22T04:33:00Z", 844919, 8000)], start);
    expect(c).toMatchObject({ km: 0, donate: 0, newWeekNoData: true, donatedTotal: 8000 });
  });

  it("uses this week's KM and donate since the reset", () => {
    const start = Date.parse(R);
    const c = weekContribution([p("2026-11-23T05:00:00Z", 900000, 8000), p("2026-11-24T05:00:00Z", 12000, 8500)], start);
    expect(c).toMatchObject({ km: 12000, donate: 500, donateApprox: false, newWeekNoData: false });
  });

  it("marks donate approximate when the reference is far before the reset, unknown when none", () => {
    const start = Date.parse(R);
    expect(weekContribution([p("2026-11-22T04:33:00Z", 1, 8000), p("2026-11-24T05:00:00Z", 2, 9000)], start).donateApprox).toBe(true);
    const only = weekContribution([p("2026-11-24T05:00:00Z", 2, 9000), p("2026-11-24T09:00:00Z", 3, 9400)], start);
    expect(only).toMatchObject({ donate: 400, donateSinceFirst: true });
  });
});

describe("daily periods (00:00 → 00:00 Vietnam time)", () => {
  // day = 2026-11-19 00:00 VN (= 11-21T17:00Z) → 2026-11-20 00:00 VN (= 11-22T17:00Z)
  const day = dayPeriodAt(Date.parse("2026-11-19T05:00:00Z"), S, 0);
  const D: RequirementConfig = { ...DEFAULT_REQUIREMENT, period: "daily", mode: "ANY", min_km: 100000, min_donate: 5000, warning_pct: 0 };
  const SS = { ...S, day_edge_tolerance_min: 60 };
  const pt2 = (id: string, iso: string, km: number, don: number) => pt(id, iso, km, don);
  const after = Date.parse("2026-11-20T03:00:00Z");

  it("keeps a 24h day for any start hour (e.g. 14:00)", () => {
    for (const h of [0, 7, 12, 14, 23]) {
      const pr = dayPeriodAt(Date.parse("2026-11-22T13:50:00Z"), S, h);
      expect(pr.end - pr.start).toBe(24 * 3600_000);
      expect(pr.start).toBeLessThanOrEqual(Date.parse("2026-11-22T13:50:00Z"));
      expect(pr.end).toBeGreaterThan(Date.parse("2026-11-22T13:50:00Z"));
    }
  });

  it("computes the local day boundaries", () => {
    expect(new Date(day.start).toISOString()).toBe("2026-11-18T17:00:00.000Z");
    expect(new Date(day.end).toISOString()).toBe("2026-11-19T17:00:00.000Z");
  });

  it("shows progress during the day (screenshots 28 minutes apart)", () => {
    const r = evaluateMemberDaily([pt2("a", "2026-11-19T04:33:00Z", 844919, 8000), pt2("b", "2026-11-19T05:01:00Z", 850000, 8000)], day, Date.parse("2026-11-19T06:00:00Z"), D, SS);
    expect(r.status).toBe("PENDING");
    expect(r.km.value).toBe(5081);
    expect(r.reason_summary).toContain("Đang trong ngày");
  });

  it("passes as soon as the requirement is met during the day", () => {
    const r = evaluateMemberDaily([pt2("a", "2026-11-19T04:33:00Z", 0, 0), pt2("b", "2026-11-19T09:00:00Z", 120000, 0)], day, Date.parse("2026-11-19T10:00:00Z"), D, SS);
    expect(r.status).toBe("PASS");
  });

  it("FAIL after the day when snapshots are near both midnights", () => {
    const r = evaluateMemberDaily(
      [pt2("a", "2026-11-18T16:40:00Z", 10000, 100), pt2("b", "2026-11-19T17:30:00Z", 40000, 100)],
      day, after, D, SS,
    );
    expect(r.status).toBe("FAIL");
    expect(r.km).toEqual({ value: 30000, exact: true, flags: [] });
  });

  it("FAIL via upper bound even without snapshots near midnight", () => {
    const r = evaluateMemberDaily(
      [pt2("a", "2026-11-18T10:00:00Z", 10000, 100), pt2("b", "2026-11-19T05:00:00Z", 20000, 100), pt2("c", "2026-11-20T01:00:00Z", 30000, 100)],
      day, after, D, SS,
    );
    expect(r.status).toBe("FAIL");
    expect(r.flags).toContain("upper_bound_fail");
  });

  it("PENDING with an estimate when it cannot be decided", () => {
    const r = evaluateMemberDaily(
      [pt2("a", "2026-11-18T10:00:00Z", 0, 0), pt2("b", "2026-11-19T05:00:00Z", 60000, 0), pt2("c", "2026-11-20T01:00:00Z", 200000, 0)],
      day, after, D, SS,
    );
    expect(r.status).toBe("PENDING");
    expect(r.reasons.join(" ")).toContain("Ước tính");
  });
});
