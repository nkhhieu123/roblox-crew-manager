import type { ConditionNode, Gain, GroupNode, Metric, RequirementConfig, RuleNode } from "./types";

/** Three-valued logic result: true, false, or null (= unknown, not enough data). */
export type Tri = boolean | null;

export interface LeafOutcome {
  node: ConditionNode;
  threshold: number; // possibly scaled to the actual interval
  value: number | null;
  exact: boolean;
  result: Tri;
}

export interface TreeOutcome {
  result: Tri;
  /** 0..1 — how close the member is to satisfying the rule (used for WARNING). */
  closeness: number;
  leaves: LeafOutcome[];
}

/** Turn the requirement config into a rule tree (ANY → OR, ALL → AND, CUSTOM → as defined). */
export function buildRuleTree(cfg: RequirementConfig): GroupNode {
  if (cfg.mode === "CUSTOM") return cfg.custom;
  const children: ConditionNode[] = [];
  if (cfg.use_km) children.push({ type: "cond", metric: "km", op: ">=", value: cfg.min_km });
  if (cfg.use_donate) children.push({ type: "cond", metric: "donate", op: ">=", value: cfg.min_donate });
  return { type: "group", op: cfg.mode === "ALL" ? "AND" : "OR", children };
}

export function countConditions(node: RuleNode): number {
  return node.type === "cond" ? 1 : node.children.reduce((n, c) => n + countConditions(c), 0);
}

/** Minimum threshold per metric appearing anywhere in the tree (for display: "KM yêu cầu"). */
export function minThresholds(node: RuleNode): Partial<Record<Metric, number>> {
  const out: Partial<Record<Metric, number>> = {};
  const walk = (n: RuleNode) => {
    if (n.type === "cond") {
      out[n.metric] = out[n.metric] === undefined ? n.value : Math.min(out[n.metric]!, n.value);
    } else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

function evalLeaf(node: ConditionNode, gains: Record<Metric, Gain>, scale: number): LeafOutcome {
  const g = gains[node.metric];
  const threshold = Math.round(node.value * scale * 100) / 100;
  let result: Tri;
  if (g.value === null) result = null;
  else {
    const meets = node.op === ">" ? g.value > threshold : g.value >= threshold;
    // a lower-bound value that already meets the threshold is a definite PASS;
    // a lower-bound value below the threshold proves nothing.
    result = meets ? true : g.exact ? false : null;
  }
  return { node, threshold, value: g.value, exact: g.exact, result };
}

function leafCloseness(l: LeafOutcome): number {
  if (l.value === null) return 0;
  if (l.threshold <= 0) return l.result === true ? 1 : 0;
  return Math.max(0, Math.min(1, l.value / l.threshold));
}

/**
 * Evaluate a rule tree with Kleene three-valued logic.
 * `scale` multiplies thresholds (when the real interval is longer than the window).
 */
export function evaluateTree(root: GroupNode, gains: Record<Metric, Gain>, scale = 1): TreeOutcome {
  const leaves: LeafOutcome[] = [];
  const walk = (n: RuleNode): { result: Tri; closeness: number } => {
    if (n.type === "cond") {
      const l = evalLeaf(n, gains, scale);
      leaves.push(l);
      return { result: l.result, closeness: leafCloseness(l) };
    }
    const parts = n.children.map(walk);
    if (parts.length === 0) return { result: null, closeness: 0 };
    if (n.op === "AND") {
      const result: Tri = parts.some((p) => p.result === false)
        ? false
        : parts.every((p) => p.result === true)
          ? true
          : null;
      return { result, closeness: Math.min(...parts.map((p) => p.closeness)) };
    }
    const result: Tri = parts.some((p) => p.result === true)
      ? true
      : parts.every((p) => p.result === false)
        ? false
        : null;
    return { result, closeness: Math.max(...parts.map((p) => p.closeness)) };
  };
  const { result, closeness } = walk(root);
  return { result, closeness, leaves };
}

const METRIC_LABEL: Record<Metric, string> = { km: "KM", donate: "Donate" };

export function describeTree(node: RuleNode, top = true): string {
  if (node.type === "cond") return `${METRIC_LABEL[node.metric]} ${node.op} ${fmt(node.value)}`;
  if (node.children.length === 0) return "(trống)";
  const inner = node.children.map((c) => describeTree(c, false)).join(` ${node.op} `);
  return top || node.children.length === 1 ? inner : `(${inner})`;
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

export { METRIC_LABEL };
