import "server-only";
import { db, must } from "./supabase";
import { chunk, fetchAll } from "./fetch-all";
import { getSettings } from "./settings";
import { ensureVersion, getActiveRequirement } from "./requirements";
import { audit } from "./audit";
import { evaluateMember } from "@/lib/engine/evaluate";
import { usernameKey } from "@/lib/engine/parse";
import type { DataPoint, DonateType, Status } from "@/lib/engine/types";

const DAY = 86_400_000;

interface SnapshotRow {
  id: string;
  captured_at: string;
  donate_type: DonateType;
}

interface EntryRow {
  snapshot_id: string;
  member_id: string;
  weekly_km: number | null;
  donated: number | null;
}

interface MemberRow {
  id: string;
  username: string;
  exempt: boolean;
}

export interface EvaluationSummary {
  total: number;
  PASS: number;
  FAIL: number;
  PENDING: number;
  WARNING: number;
  EXEMPT: number;
  no_new_data: number;
  km_total: number;
  donate_total: number;
}

export type RunResult =
  | { ok: true; evaluationId: string; summary: EvaluationSummary }
  | { ok: false; reason: string };

/**
 * Evaluate every member at `snapshotId` (default: latest snapshot) with the active requirement set.
 * The config and settings used are frozen into the evaluation row so history never changes.
 */
export async function runEvaluation(opts: { snapshotId?: string; actor: string; trigger: "auto" | "manual" }): Promise<RunResult> {
  const set = await getActiveRequirement();
  if (!set) return { ok: false, reason: "Chưa có bộ điều kiện nào đang được áp dụng (Requirements)." };
  const settings = await getSettings();
  const cfg = set.config;

  // ---- target snapshot ----
  const targetQuery = db().from("snapshots").select("id, captured_at, donate_type");
  const target = must(
    opts.snapshotId
      ? await targetQuery.eq("id", opts.snapshotId).maybeSingle()
      : await targetQuery.order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    "Load target snapshot",
  ) as SnapshotRow | null;
  if (!target) return { ok: false, reason: "Chưa có snapshot nào." };

  const targetMs = new Date(target.captured_at).getTime();
  const lookbackMs = Math.max(cfg.window_hours * 3600_000 * 4, 45 * DAY);
  const fromIso = new Date(targetMs - lookbackMs).toISOString();

  // ---- data ----
  const snapshots = await fetchAll<SnapshotRow>(
    (a, b) =>
      db()
        .from("snapshots")
        .select("id, captured_at, donate_type")
        .gte("captured_at", fromIso)
        .lte("captured_at", target.captured_at)
        .order("captured_at")
        .range(a, b),
    "Load snapshots",
  );
  const snapById = new Map(snapshots.map((s) => [s.id, s]));

  const entries = await fetchAll<EntryRow>(
    (a, b) =>
      db()
        .from("snapshot_entries")
        .select("snapshot_id, member_id, weekly_km, donated, snapshots!inner(captured_at)")
        .eq("verified", true)
        .gte("snapshots.captured_at", fromIso)
        .lte("snapshots.captured_at", target.captured_at)
        .order("id")
        .range(a, b),
    "Load entries",
  );

  const members = await fetchAll<MemberRow>(
    (a, b) => db().from("members").select("id, username, exempt").order("id").range(a, b),
    "Load members",
  );

  const pointsByMember = new Map<string, DataPoint[]>();
  for (const e of entries) {
    const s = snapById.get(e.snapshot_id);
    if (!s) continue;
    const list = pointsByMember.get(e.member_id) ?? [];
    list.push({
      snapshot_id: s.id,
      captured_at: s.captured_at,
      weekly_km: e.weekly_km === null ? null : Number(e.weekly_km),
      donated: e.donated === null ? null : Number(e.donated),
      donate_type: s.donate_type,
    });
    pointsByMember.set(e.member_id, list);
  }

  // ---- previous evaluation (for consecutive violation counts) ----
  const prev = must(
    await db()
      .from("evaluations")
      .select("id")
      .eq("superseded", false)
      .lt("to_captured_at", target.captured_at)
      .order("to_captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Load previous evaluation",
  ) as { id: string } | null;
  const prevCounts = new Map<string, number>();
  if (prev) {
    const rows = await fetchAll<{ member_id: string; consecutive_fails: number }>(
      (a, b) =>
        db()
          .from("evaluation_results")
          .select("member_id, consecutive_fails")
          .eq("evaluation_id", prev.id)
          .order("id")
          .range(a, b),
      "Load previous results",
    );
    for (const r of rows) prevCounts.set(r.member_id, r.consecutive_fails ?? 0);
  }

  const exemptKeys = new Set(cfg.exempt_usernames.map(usernameKey));
  const includedKeys = new Set(cfg.included_usernames.map(usernameKey));

  const summary: EvaluationSummary = {
    total: 0, PASS: 0, FAIL: 0, PENDING: 0, WARNING: 0, EXEMPT: 0, no_new_data: 0, km_total: 0, donate_total: 0,
  };

  const results = [];
  for (const m of members) {
    const points = pointsByMember.get(m.id);
    if (!points || points.length === 0) continue; // not seen in the lookback period — left the crew long ago
    const key = usernameKey(m.username);
    const r = evaluateMember(points, target.id, cfg, settings, {
      exempt: m.exempt || exemptKeys.has(key),
      inScope: cfg.applies_to_all || includedKeys.has(key),
    });
    const prevCount = prevCounts.get(m.id) ?? 0;
    const consecutive =
      r.status === "FAIL" ? prevCount + 1 : r.status === "PENDING" ? prevCount : 0;

    summary.total++;
    summary[r.status as Status]++;
    if (r.flags.includes("no_new_data")) summary.no_new_data++;
    if (r.km.value) summary.km_total += r.km.value;
    if (r.donate.value) summary.donate_total += r.donate.value;

    results.push({
      member_id: m.id,
      username: m.username,
      status: r.status,
      km_gain: r.km.value,
      km_gain_exact: r.km.value === null ? null : r.km.exact,
      donate_gain: r.donate.value,
      donate_gain_exact: r.donate.value === null ? null : r.donate.exact,
      km_required: r.km_required,
      donate_required: r.donate_required,
      from_snapshot_id: r.from_snapshot_id,
      from_captured_at: r.from_captured_at,
      to_captured_at: r.to_captured_at,
      hours: r.hours,
      km_per_day: r.km_per_day,
      donate_per_day: r.donate_per_day,
      reason_summary: r.reason_summary,
      reasons: r.reasons,
      flags: r.flags,
      consecutive_fails: consecutive,
    });
  }

  const versionId = await ensureVersion(set, opts.actor);

  // supersede previous runs for the same snapshot (they stay in history)
  must(
    await db().from("evaluations").update({ superseded: true }).eq("to_snapshot_id", target.id).eq("superseded", false),
    "Supersede old evaluations",
  );

  const evaluation = must(
    await db()
      .from("evaluations")
      .insert({
        requirement_version_id: versionId,
        requirement_name: `${set.name} (v${set.version})`,
        config: cfg,
        settings,
        to_snapshot_id: target.id,
        to_captured_at: target.captured_at,
        summary,
        trigger: opts.trigger,
        created_by: opts.actor,
      })
      .select("id")
      .single(),
    "Create evaluation",
  ) as { id: string };

  try {
    for (const part of chunk(results, 500)) {
      must(
        await db().from("evaluation_results").insert(part.map((r) => ({ ...r, evaluation_id: evaluation.id }))),
        "Insert evaluation results",
      );
    }
  } catch (e) {
    await db().from("evaluations").delete().eq("id", evaluation.id);
    throw e;
  }

  await audit(opts.actor, "evaluation.run", "evaluation", evaluation.id, {
    trigger: opts.trigger,
    snapshot_id: target.id,
    requirement: `${set.name} v${set.version}`,
    summary,
  });

  return { ok: true, evaluationId: evaluation.id, summary };
}

/** Latest non-superseded evaluation (the "current" one). */
export async function getLatestEvaluation() {
  return must(
    await db()
      .from("evaluations")
      .select("*")
      .eq("superseded", false)
      .order("to_captured_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Load latest evaluation",
  ) as EvaluationRow | null;
}

export interface EvaluationRow {
  id: string;
  requirement_name: string;
  config: import("@/lib/engine/types").RequirementConfig;
  settings: import("@/lib/engine/types").GeneralSettings;
  to_snapshot_id: string | null;
  to_captured_at: string;
  summary: EvaluationSummary;
  superseded: boolean;
  trigger: string;
  created_by: string;
  created_at: string;
}

export interface ResultRow {
  id: string;
  evaluation_id: string;
  member_id: string | null;
  username: string;
  status: Status;
  km_gain: number | null;
  km_gain_exact: boolean | null;
  donate_gain: number | null;
  donate_gain_exact: boolean | null;
  km_required: number | null;
  donate_required: number | null;
  from_snapshot_id: string | null;
  from_captured_at: string | null;
  to_captured_at: string | null;
  hours: number | null;
  km_per_day: number | null;
  donate_per_day: number | null;
  reason_summary: string | null;
  reasons: string[];
  flags: string[];
  consecutive_fails: number;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
}
