import type { DataPoint, Gain, GeneralSettings, MemberEvaluation, Metric, RequirementConfig } from "./types";
import { crossesWeeklyReset } from "./week";
import { buildRuleTree, countConditions, evaluateTree, fmt, METRIC_LABEL, minThresholds } from "./rules";

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
    if (crossesWeeklyReset(t(a), t(b), s)) {
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
    return {
      ...base,
      status: "PENDING",
      reason_summary: "Thiếu dữ liệu để xác minh",
      reasons: [
        `${FLAG_LABELS.no_baseline} (cần snapshot cũ hơn ít nhất ${fmt(W * (1 - settings.baseline_tolerance_pct / 100), 1)} giờ)`,
      ],
      flags: ["no_baseline"],
    };
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

  const reasons: string[] = outcome.leaves.map((l) => {
    const label = METRIC_LABEL[l.node.metric];
    const val = l.value === null ? "chưa rõ" : `${fmt(l.value)}${l.exact ? "" : " (tối thiểu)"}`;
    const verdict = l.result === true ? "đạt" : l.result === false ? "không đạt" : "chưa xác định";
    return `${label} tăng ${val} / yêu cầu ${l.node.op} ${fmt(l.threshold)} — ${verdict}`;
  });
  for (const f of flags) if (FLAG_LABELS[f]) reasons.push(FLAG_LABELS[f]);

  let status: MemberEvaluation["status"];
  let summary: string;
  if (outcome.result === true) {
    status = "PASS";
    summary = "Đạt yêu cầu";
  } else if (outcome.result === null) {
    status = "PENDING";
    summary = "Thiếu dữ liệu để xác minh";
  } else {
    const failing = new Set(outcome.leaves.filter((l) => l.result === false).map((l) => l.node.metric));
    if (cfg.mode === "CUSTOM") summary = "Không thỏa điều kiện tùy chỉnh";
    else if (failing.has("km") && failing.has("donate")) summary = "Không đạt cả hai điều kiện";
    else if (failing.has("km")) summary = "Không đạt mức KM tối thiểu";
    else summary = "Không đạt mức Donate tối thiểu";

    if (cfg.warning_pct > 0 && outcome.closeness >= cfg.warning_pct / 100) {
      status = "WARNING";
      summary = `Gần đạt (${Math.floor(outcome.closeness * 100)}% yêu cầu) — ${summary.toLowerCase()}`;
    } else status = "FAIL";
  }

  return { ...base, status, reason_summary: summary, reasons, flags: [...flags] };
}

function round(n: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export type { Metric };
