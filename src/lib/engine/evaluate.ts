import type { DataPoint, Gain, GeneralSettings, MemberEvaluation, Metric, RequirementConfig } from "./types";
import { localParts, resetBetween, zonedToUtc } from "./week";
import { buildRuleTree, countConditions, evaluateTree, fmt, METRIC_LABEL, minThresholds, type TreeOutcome } from "./rules";

const HOUR = 3600_000;

export const FLAG_LABELS: Record<string, string> = {
  weekly_reset: "Weekly KM đã reset trong khoảng đánh giá — chỉ biết mức tăng tối thiểu",
  km_decreased: "KM giảm mà không trùng mốc reset tuần (có thể reset sớm hoặc OCR sai)",
  donate_weekly_reset: "Donate (theo tuần) đã reset trong khoảng đánh giá",
  donate_decreased: "Donate tích lũy bị giảm — dữ liệu bất thường, cần kiểm tra",
  donate_type_changed: "Loại chỉ số Donate khác nhau giữa hai snapshot — không so sánh được",
  missing_km: "Thiếu số KM ở snapshot đầu hoặc cuối",
  missing_donate: "Thiếu số Donate ở snapshot đầu hoặc cuối",
  no_new_data: "Không có dữ liệu (đã xác thực) trong snapshot đang đánh giá",
  no_baseline: "Chưa có snapshot đủ cũ để so sánh",
  window_longer: "Khoảng thời gian thực tế dài hơn chu kỳ — yêu cầu được tính theo tỷ lệ",
  not_in_scope: "Không thuộc phạm vi áp dụng của bộ điều kiện",
  exempt: "Được miễn điều kiện",
  empty_rule: "Bộ điều kiện chưa có điều kiện nào",
  in_progress: "Ngày chưa kết thúc",
  day_not_covered: "Thiếu ảnh gần 0 giờ để chốt kết quả ngày",
  upper_bound_fail: "Không đạt ngay cả khi tính rộng hơn cả ngày",
  early_pass: "Đã đạt trước khi đủ chu kỳ",
};

type ResetSettings = Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">;

const t = (p: DataPoint) => new Date(p.captured_at).getTime();

/**
 * Gain of a metric that resets every week (Weekly KM, or weekly Donate),
 * summed over consecutive snapshots from baseline to target.
 */
export function weeklyGain(
  points: DataPoint[],
  pick: (p: DataPoint) => number | null,
  s: ResetSettings,
  resetFlag: string,
  decreaseFlag: string,
): Gain {
  const flags = new Set<string>();
  const usable = points.filter((p) => pick(p) !== null);
  let total = 0;
  let exact = true;
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1];
    const b = usable[i];
    const va = pick(a)!;
    const vb = pick(b)!;
    if (resetBetween({ ms: t(a), next_reset_at: a.next_reset_at }, { ms: t(b), next_reset_at: b.next_reset_at }, s)) {
      // value b is what was earned since the reset; what happened between a and the reset is unknown (≥ 0)
      total += vb;
      exact = false;
      flags.add(resetFlag);
    } else if (vb < va) {
      // decrease without a known reset → treat as an unexpected reset, lower bound only
      total += vb;
      exact = false;
      flags.add(decreaseFlag);
    } else {
      total += vb - va;
    }
  }
  return { value: round(total), exact, flags: [...flags] };
}

/** Gain of a cumulative (all-time) counter, e.g. total Donated. */
export function cumulativeGain(points: DataPoint[], pick: (p: DataPoint) => number | null): Gain {
  const flags = new Set<string>();
  const usable = points.filter((p) => pick(p) !== null);
  let total = 0;
  let exact = true;
  for (let i = 1; i < usable.length; i++) {
    const d = pick(usable[i])! - pick(usable[i - 1])!;
    if (d < 0) {
      exact = false;
      flags.add("donate_decreased");
    } else total += d;
  }
  return { value: round(total), exact, flags: [...flags] };
}

export function kmGain(chain: DataPoint[], s: ResetSettings): Gain {
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (first.weekly_km === null || last.weekly_km === null) {
    return { value: null, exact: false, flags: ["missing_km"] };
  }
  return weeklyGain(chain, (p) => p.weekly_km, s, "weekly_reset", "km_decreased");
}

export function donateGain(chain: DataPoint[], s: ResetSettings): Gain {
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (first.donated === null || last.donated === null) {
    return { value: null, exact: false, flags: ["missing_donate"] };
  }
  const types = new Set(chain.filter((p) => p.donated !== null).map((p) => p.donate_type));
  if (types.size > 1) return { value: null, exact: false, flags: ["donate_type_changed"] };
  if (last.donate_type === "weekly") {
    return weeklyGain(chain, (p) => p.donated, s, "donate_weekly_reset", "donate_decreased");
  }
  return cumulativeGain(chain, (p) => p.donated);
}

/**
 * Pick the baseline: the newest data point captured at or before
 * target − window × (1 − tolerance). Returns the chain baseline…target.
 */
export function pickChain(
  points: DataPoint[],
  targetSnapshotId: string,
  windowHours: number,
  tolerancePct: number,
): { chain: DataPoint[] | null; target: DataPoint | null } {
  const sorted = [...points].sort((a, b) => t(a) - t(b));
  const ti = sorted.findIndex((p) => p.snapshot_id === targetSnapshotId);
  if (ti < 0) return { chain: null, target: null };
  const target = sorted[ti];
  const cutoff = t(target) - windowHours * HOUR * (1 - tolerancePct / 100);
  let bi = -1;
  for (let i = ti - 1; i >= 0; i--) {
    if (t(sorted[i]) <= cutoff) {
      bi = i;
      break;
    }
  }
  if (bi < 0) return { chain: null, target };
  return { chain: sorted.slice(bi, ti + 1), target };
}

export interface EvaluateOptions {
  exempt?: boolean;
  inScope?: boolean;
}

/** Evaluate one member at the target snapshot. `points` = the member's verified data points. */
export function evaluateMember(
  points: DataPoint[],
  targetSnapshotId: string,
  cfg: RequirementConfig,
  settings: GeneralSettings,
  opts: EvaluateOptions = {},
): MemberEvaluation {
  const tree = buildRuleTree(cfg);
  const mins = minThresholds(tree);
  const W = cfg.window_hours;
  const base: MemberEvaluation = {
    status: "PENDING",
    km: { value: null, exact: false, flags: [] },
    donate: { value: null, exact: false, flags: [] },
    km_required: mins.km ?? null,
    donate_required: mins.donate ?? null,
    from_snapshot_id: null,
    from_captured_at: null,
    to_captured_at: null,
    hours: null,
    km_per_day: null,
    donate_per_day: null,
    reason_summary: "",
    reasons: [],
    flags: [],
  };

  const { chain, target } = pickChain(points, targetSnapshotId, W, settings.baseline_tolerance_pct);
  if (target) base.to_captured_at = target.captured_at;

  if (chain) {
    const from = chain[0];
    const hours = (t(target!) - t(from)) / HOUR;
    base.from_snapshot_id = from.snapshot_id;
    base.from_captured_at = from.captured_at;
    base.hours = round(hours, 2);
    base.km = kmGain(chain, settings);
    base.donate = donateGain(chain, settings);
    base.km_per_day = base.km.value === null ? null : round((base.km.value / hours) * 24);
    base.donate_per_day = base.donate.value === null ? null : round((base.donate.value / hours) * 24);
  }

  // ---- Exemptions / scope (gains still shown for information) ----
  if (opts.inScope === false) {
    return { ...base, status: "EXEMPT", reason_summary: FLAG_LABELS.not_in_scope, flags: ["not_in_scope"] };
  }
  if (opts.exempt) {
    return { ...base, status: "EXEMPT", reason_summary: FLAG_LABELS.exempt, flags: ["exempt"] };
  }
  if (countConditions(tree) === 0) {
    return { ...base, status: "PENDING", reason_summary: FLAG_LABELS.empty_rule, flags: ["empty_rule"] };
  }
  if (!target) {
    return {
      ...base,
      status: "PENDING",
      reason_summary: "Thiếu dữ liệu để xác minh",
      reasons: [FLAG_LABELS.no_new_data],
      flags: ["no_new_data"],
    };
  }
  if (!chain) {
    // not enough history for a full window yet: still show progress since the earliest snapshot.
    // It is a lower bound for the window, so it can PASS early but never FAIL.
    const sorted = [...points].sort((a, b) => t(a) - t(b));
    const first = sorted[0];
    const need = `${FLAG_LABELS.no_baseline} (cần snapshot cũ hơn ít nhất ${fmt(W * (1 - settings.baseline_tolerance_pct / 100), 1)} giờ)`;
    if (first && first.snapshot_id !== target.snapshot_id) {
      const partial = sorted.filter((p) => t(p) <= t(target));
      const hours = (t(target) - t(first)) / HOUR;
      const km = { ...kmGain(partial, settings), exact: false };
      const donate = { ...donateGain(partial, settings), exact: false };
      const outcome = evaluateTree(tree, { km, donate }, 1);
      const prog = { ...base, km, donate, from_snapshot_id: first.snapshot_id, from_captured_at: first.captured_at, hours: round(hours, 2) };
      if (outcome.result === true) {
        return { ...prog, status: "PASS", reason_summary: `Đạt yêu cầu (đạt sớm sau ${fmt(hours, 1)} giờ)`, reasons: leafReasons(outcome), flags: ["early_pass"] };
      }
      return {
        ...prog,
        status: "PENDING",
        reason_summary: `Đang tính: mới có ${fmt(hours, 1)}/${fmt(W)} giờ dữ liệu`,
        reasons: [...leafReasons(outcome), need],
        flags: ["no_baseline"],
      };
    }
    return { ...base, status: "PENDING", reason_summary: "Thiếu dữ liệu để xác minh", reasons: [need], flags: ["no_baseline"] };
  }

  // ---- Evaluate the rule ----
  const hours = base.hours!;
  const flags = new Set<string>([...base.km.flags, ...base.donate.flags]);
  let scale = 1;
  if (hours > W * (1 + settings.baseline_tolerance_pct / 100)) {
    scale = hours / W;
    flags.add("window_longer");
  }
  const outcome = evaluateTree(tree, { km: base.km, donate: base.donate }, scale);
  base.km_required = mins.km !== undefined ? round(mins.km * scale) : null;
  base.donate_required = mins.donate !== undefined ? round(mins.donate * scale) : null;

  const reasons = leafReasons(outcome);
  for (const f of flags) if (FLAG_LABELS[f]) reasons.push(FLAG_LABELS[f]);
  const { status, summary } = decide(outcome, cfg);
  return { ...base, status, reason_summary: summary, reasons, flags: [...flags] };
}

function leafReasons(outcome: TreeOutcome, prefix = "tăng"): string[] {
  return outcome.leaves.map((l) => {
    const label = METRIC_LABEL[l.node.metric];
    const val = l.value === null ? "chưa rõ" : `${fmt(l.value)}${l.exact ? "" : " (tối thiểu)"}`;
    const verdict = l.result === true ? "đạt" : l.result === false ? "không đạt" : "chưa xác định";
    return `${label} ${prefix} ${val} / yêu cầu ${l.node.op} ${fmt(l.threshold)} — ${verdict}`;
  });
}

function failSummary(outcome: TreeOutcome, cfg: RequirementConfig): string {
  const failing = new Set(outcome.leaves.filter((l) => l.result === false).map((l) => l.node.metric));
  if (cfg.mode === "CUSTOM") return "Không thỏa điều kiện tùy chỉnh";
  if (failing.has("km") && failing.has("donate")) return "Không đạt cả hai điều kiện";
  if (failing.has("km")) return "Không đạt mức KM tối thiểu";
  return "Không đạt mức Donate tối thiểu";
}

function decide(outcome: TreeOutcome, cfg: RequirementConfig): { status: MemberEvaluation["status"]; summary: string } {
  if (outcome.result === true) return { status: "PASS", summary: "Đạt yêu cầu" };
  if (outcome.result === null) return { status: "PENDING", summary: "Thiếu dữ liệu để xác minh" };
  const summary = failSummary(outcome, cfg);
  if (cfg.warning_pct > 0 && outcome.closeness >= cfg.warning_pct / 100) {
    return { status: "WARNING", summary: `Gần đạt (${Math.floor(outcome.closeness * 100)}% yêu cầu) — ${summary.toLowerCase()}` };
  }
  return { status: "FAIL", summary };
}

// ---------------------------------------------------------------------------
// Daily periods: each calendar day (00:00 -> 00:00 next day, local time) is one evaluation period.
// Screenshots can be taken at any time, so the value at 00:00 is anchored as follows:
//  - a snapshot within `day_edge_tolerance_min` of 00:00 counts as taken at 00:00;
//  - otherwise the day's gain is bounded: lower = between snapshots inside the day,
//    upper = from the last snapshot before the day to the first one after it.
// PASS as soon as the lower bound meets the rule. FAIL only after the day is over, when the day is covered
// by snapshots near both 00:00 marks, or when even the upper bound misses the rule. Otherwise PENDING,
// with an interpolated estimate shown for information only (never used to decide).
// ---------------------------------------------------------------------------

export interface Period {
  start: number; // ms
  end: number; // ms
}

function interpolate(a: DataPoint, b: DataPoint, at: number, pick: (p: DataPoint) => number | null, s: GeneralSettings): number | null {
  const va = pick(a);
  const vb = pick(b);
  if (va === null || vb === null || vb < va) return null;
  if (resetBetween({ ms: t(a), next_reset_at: a.next_reset_at }, { ms: t(b), next_reset_at: b.next_reset_at }, s)) return null;
  const f = (at - t(a)) / (t(b) - t(a));
  return va + (vb - va) * Math.min(1, Math.max(0, f));
}

export function evaluateMemberDaily(
  points: DataPoint[],
  period: Period,
  nowMs: number,
  cfg: RequirementConfig,
  settings: GeneralSettings,
  opts: EvaluateOptions = {},
): MemberEvaluation {
  const tree = buildRuleTree(cfg);
  const mins = minThresholds(tree);
  const tol = (settings.day_edge_tolerance_min ?? 60) * 60_000;
  const sorted = [...points].sort((a, b) => t(a) - t(b));
  const inside = sorted.filter((p) => t(p) >= period.start && t(p) <= period.end);
  const before = [...sorted].reverse().find((p) => t(p) < period.start);
  const after = sorted.find((p) => t(p) > period.end);
  const dayOver = nowMs >= period.end;

  const startAnchor = before && period.start - t(before) <= tol ? before : inside[0];
  const endAnchor = after && t(after) - period.end <= tol ? after : inside[inside.length - 1];
  const lowChain =
    startAnchor && endAnchor && t(endAnchor) > t(startAnchor) ? sorted.filter((p) => t(p) >= t(startAnchor) && t(p) <= t(endAnchor)) : null;
  const coversStart = !!startAnchor && Math.abs(t(startAnchor) - period.start) <= tol;
  const coversEnd = !!endAnchor && Math.abs(period.end - t(endAnchor)) <= tol;
  const fullyCovered = coversStart && coversEnd;

  const base: MemberEvaluation = {
    status: "PENDING",
    km: { value: null, exact: false, flags: [] },
    donate: { value: null, exact: false, flags: [] },
    km_required: mins.km ?? null,
    donate_required: mins.donate ?? null,
    from_snapshot_id: startAnchor?.snapshot_id ?? null,
    from_captured_at: startAnchor?.captured_at ?? null,
    to_captured_at: endAnchor?.captured_at ?? null,
    hours: startAnchor && endAnchor && lowChain ? round((t(endAnchor) - t(startAnchor)) / HOUR, 2) : null,
    km_per_day: null,
    donate_per_day: null,
    reason_summary: "",
    reasons: [],
    flags: [],
  };

  if (opts.inScope === false) return { ...base, status: "EXEMPT", reason_summary: FLAG_LABELS.not_in_scope, flags: ["not_in_scope"] };
  if (countConditions(tree) === 0) return { ...base, reason_summary: FLAG_LABELS.empty_rule, flags: ["empty_rule"] };

  let lowKm: Gain = { value: null, exact: false, flags: [] };
  let lowDon: Gain = { value: null, exact: false, flags: [] };
  if (lowChain) {
    lowKm = kmGain(lowChain, settings);
    lowDon = donateGain(lowChain, settings);
    if (!fullyCovered) {
      lowKm = { ...lowKm, exact: false };
      lowDon = { ...lowDon, exact: false };
    }
  }
  base.km = lowKm;
  base.donate = lowDon;

  if (opts.exempt) return { ...base, status: "EXEMPT", reason_summary: FLAG_LABELS.exempt, flags: ["exempt"] };

  const flags = new Set<string>([...lowKm.flags, ...lowDon.flags]);
  const low = evaluateTree(tree, { km: lowKm, donate: lowDon }, 1);
  const reasons = leafReasons(low, "trong ngày");

  if (low.result === true) {
    return { ...base, status: "PASS", reason_summary: dayOver ? "Đạt yêu cầu trong ngày" : "Đã đạt yêu cầu hôm nay", reasons, flags: [...flags] };
  }

  if (!dayOver) {
    const hoursLeft = Math.max(0, (period.end - nowMs) / HOUR);
    return {
      ...base,
      status: "PENDING",
      reason_summary: lowChain ? `Đang trong ngày — còn ${fmt(hoursLeft, 1)} giờ` : "Chưa đủ ảnh trong ngày để tính",
      reasons: lowChain ? reasons : ["Cần ít nhất 2 ảnh trong ngày (hoặc 1 ảnh gần 0 giờ + 1 ảnh trong ngày)"],
      flags: [...flags, "in_progress"],
    };
  }

  if (low.result === false && fullyCovered) {
    const d = decide(low, cfg);
    return { ...base, status: d.status, reason_summary: d.summary, reasons, flags: [...flags] };
  }

  // day over but not covered near 00:00 -> upper bound over a wider span can still prove a failure
  if (before && after) {
    const hiChain = sorted.filter((p) => t(p) >= t(before) && t(p) <= t(after));
    const hiKm = kmGain(hiChain, settings);
    const hiDon = donateGain(hiChain, settings);
    const high = evaluateTree(tree, { km: hiKm, donate: hiDon }, 1);
    if (high.result === false) {
      const d = decide(high, cfg);
      return {
        ...base,
        status: d.status,
        reason_summary: d.summary,
        reasons: [
          ...leafReasons(high, "tăng (tính rộng hơn cả ngày)"),
          "Không có ảnh sát 0 giờ — đã tính từ ảnh trước 0h đầu ngày tới ảnh sau 0h cuối ngày mà vẫn không đạt",
        ],
        flags: [...flags, "upper_bound_fail"],
      };
    }
  }

  // still undecided: show an interpolated estimate for information only
  const est: string[] = [];
  const startVal = (pick: (p: DataPoint) => number | null) =>
    coversStart && startAnchor ? pick(startAnchor) : before && inside[0] ? interpolate(before, inside[0], period.start, pick, settings) : null;
  const endVal = (pick: (p: DataPoint) => number | null) =>
    coversEnd && endAnchor ? pick(endAnchor) : after && inside.length ? interpolate(inside[inside.length - 1], after, period.end, pick, settings) : null;
  for (const [label, pick] of [
    ["KM", (p: DataPoint) => p.weekly_km],
    ["Donate", (p: DataPoint) => p.donated],
  ] as const) {
    const a = startVal(pick);
    const b = endVal(pick);
    if (a !== null && b !== null && b >= a) est.push(`${label} ≈ ${fmt(b - a)}`);
  }
  return {
    ...base,
    status: "PENDING",
    reason_summary: "Thiếu ảnh gần 0 giờ để chốt kết quả",
    reasons: [
      ...reasons,
      `Cần ảnh chụp trong khoảng ±${fmt(settings.day_edge_tolerance_min ?? 60)} phút quanh 00:00 đầu và cuối ngày`,
      ...(est.length ? [`Ước tính theo tốc độ (chỉ tham khảo, không dùng để loại): ${est.join(", ")}`] : []),
    ],
    flags: [...flags, "day_not_covered"],
  };
}

/** The daily period (local time, starting at `startHour`) that contains `ms`. */
export function dayPeriodAt(ms: number, settings: Pick<GeneralSettings, "timezone">, startHour = 0): Period {
  const p = localParts(ms, settings.timezone);
  // local calendar date of the period start: today, or yesterday if today's start hour is still ahead
  let date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let start = zonedToUtc(p.year, p.month, p.day, startHour, settings.timezone);
  if (start > ms) {
    date = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
    start = zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), startHour, settings.timezone);
  }
  // the next local calendar day, same hour
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), startHour, settings.timezone);
  return { start, end };
}

function round(n: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export type { Metric };
