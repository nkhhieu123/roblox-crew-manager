// Shared, framework-free types for the comparison & evaluation engine.

export type DonateType = "cumulative" | "weekly";
export type Metric = "km" | "donate";
export type Comparator = ">=" | ">";
export type Status = "PASS" | "FAIL" | "PENDING" | "WARNING" | "EXEMPT";
export type Mode = "ANY" | "ALL" | "CUSTOM";

export interface GeneralSettings {
  store_images: boolean;
  default_donate_type: DonateType;
  /** 0 = Sunday … 6 = Saturday */
  week_reset_weekday: number;
  /** 0–23, in `timezone` */
  week_reset_hour: number;
  timezone: string;
  /** Baseline snapshot may be up to this % younger than the evaluation window. */
  baseline_tolerance_pct: number;
}

export const DEFAULT_SETTINGS: GeneralSettings = {
  store_images: true,
  default_donate_type: "cumulative",
  week_reset_weekday: 1,
  week_reset_hour: 0,
  timezone: "Asia/Ho_Chi_Minh",
  baseline_tolerance_pct: 15,
};

// ---------- Requirement configuration ----------

export interface ConditionNode {
  type: "cond";
  metric: Metric;
  op: Comparator;
  value: number;
}

export interface GroupNode {
  type: "group";
  op: "AND" | "OR";
  children: RuleNode[];
}

export type RuleNode = ConditionNode | GroupNode;

export interface RequirementConfig {
  /** Evaluation window in hours (6, 12, 24, 48 or custom). */
  window_hours: number;
  mode: Mode;
  use_km: boolean;
  min_km: number;
  use_donate: boolean;
  min_donate: number;
  /** Only used when mode = CUSTOM. */
  custom: GroupNode;
  /** A failing member reaching at least this % of the requirement is WARNING instead of FAIL. 0 disables. */
  warning_pct: number;
  /** If false, only members listed in `included_usernames` are evaluated. */
  applies_to_all: boolean;
  included_usernames: string[];
  /** Usernames exempt from this requirement (in addition to members flagged exempt). */
  exempt_usernames: string[];
}

export const DEFAULT_REQUIREMENT: RequirementConfig = {
  window_hours: 24,
  mode: "ANY",
  use_km: true,
  min_km: 5000,
  use_donate: true,
  min_donate: 100,
  custom: {
    type: "group",
    op: "OR",
    children: [
      {
        type: "group",
        op: "AND",
        children: [
          { type: "cond", metric: "km", op: ">=", value: 5000 },
          { type: "cond", metric: "donate", op: ">=", value: 100 },
        ],
      },
      { type: "cond", metric: "km", op: ">=", value: 10000 },
    ],
  },
  warning_pct: 80,
  applies_to_all: true,
  included_usernames: [],
  exempt_usernames: [],
};

// ---------- Data points ----------

/** One member's values in one snapshot (only verified entries should be passed to the engine). */
export interface DataPoint {
  snapshot_id: string;
  captured_at: string; // ISO
  weekly_km: number | null;
  donated: number | null;
  donate_type: DonateType;
  /** Next weekly reset read from the in-game countdown on this snapshot (ISO), if known. */
  next_reset_at?: string | null;
}

/** A computed gain. `exact=false` means the value is only a lower bound (e.g. weekly reset crossed). */
export interface Gain {
  value: number | null;
  exact: boolean;
  flags: string[];
}

export interface MemberEvaluation {
  status: Status;
  km: Gain;
  donate: Gain;
  km_required: number | null;
  donate_required: number | null;
  from_snapshot_id: string | null;
  from_captured_at: string | null;
  to_captured_at: string | null;
  hours: number | null;
  km_per_day: number | null;
  donate_per_day: number | null;
  reason_summary: string;
  reasons: string[];
  flags: string[];
}
