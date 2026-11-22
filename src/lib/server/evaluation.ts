import "server-only";
import { db, must } from "./supabase";
import { chunk, fetchAll } from "./fetch-all";
import { getSettings } from "./settings";
import { ensureVersion, getActiveRequirement } from "./requirements";
import { audit } from "./audit";
import { dayPeriodAt, evaluateMember, evaluateMemberDaily, type Period } from "@/lib/engine/evaluate";
import { usernameKey } from "@/lib/engine/parse";
import type { DataPoint, DonateType, Status } from "@/lib/engine/types";

const DAY = 86_400_000;

interface SnapshotRow {
  id: string;
  captured_at: string;
  donate_type: DonateType;
  next_reset_at: string | null;
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
  left_at: string | null;
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

  if (cfg.period === "daily") {
    const target = must(
      opts.snapshotId
        ? await db().from("snapshots").select("id, captured_at").eq("id", opts.snapshotId).maybeSingle()
        : await db().from("snapshots").select("id, captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      "Load target snapshot",
    ) as { id: string; captured_at: string } | null;
    if (!target) return { ok: false, reason: "Chưa có snapshot nào." };
    const day = dayPeriodAt(new Date(target.captured_at).getTime(), settings, cfg.day_start_hour);
    const prevDay = dayPeriodAt(day.start - 1, settings, cfg.day_start_hour);
    // a new snapshot can also close the previous day (it gives the value at / after 00:00)
    await runDaily(set, settings, prevDay, target.id, opts.actor, opts.trigger);
    return runDaily(set, settings, day, target.id, opts.actor, opts.trigger);
  }
  return runRolling(set, settings, opts);
}

type ActiveSet = NonNullable<Awaited<ReturnType<typeof getActiveRequirement>>>;
type Settings = Awaited<ReturnType<typeof getSettings>>;

async function loadPoints(fromIso: string, toIso: string) {
  const snapshots = await fetchAll<SnapshotRow>(
    (a, b) =>
      db()
        .from("snapshots")
        .select("id, captured_at, donate_type, next_reset_at")
        .gte("captured_at", fromIso)
        .lte("captured_at", toIso)
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
        .lte("snapshots.captured_at", toIso)
        .order("id")
        .range(a, b),
    "Load entries",
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
      next_reset_at: s.next_reset_at,
    });
    pointsByMember.set(e.member_id, list);
  }
  return { snapshots, pointsByMember };
}

async function previousCounts(prevId: string | null) {
  const prevCounts = new Map<string, number>();
  if (!prevId) return prevCounts;
  const rows = await fetchAll<{ member_id: string; consecutive_fails: number }>(
    (a, b) => db().from("evaluation_results").select("member_id, consecutive_fails").eq("evaluation_id", prevId).order("id").range(a, b),
    "Load previous results",
  );
  for (const r of rows) prevCounts.set(r.member_id, r.consecutive_fails ?? 0);
  return prevCounts;
}

/** Evaluate one calendar-day period (00:00 -> 00:00) for every member. */
async function runDaily(
  set: ActiveSet,
  settings: Settings,
  period: Period,
  snapshotId: string,
  actor: string,
  trigger: "auto" | "manual",
): Promise<RunResult> {
  const cfg = set.config;
  const now = Date.now();
  const margin = 3 * DAY;
  const { snapshots, pointsByMember } = await loadPoints(
    new Date(period.start - margin).toISOString(),
    new Date(Math.min(now, period.end + margin)).toISOString(),
  );
  // nothing captured anywhere near this day → skip (e.g. the previous day before the first upload)
  const relevant = snapshots.filter((x) => {
    const ms = new Date(x.captured_at).getTime();
    return ms >= period.start - margin && ms <= period.end + margin;
  });
  const anyInside = snapshots.some((x) => {
    const ms = new Date(x.captured_at).getTime();
    return ms >= period.start && ms <= period.end;
  });
  if (!anyInside || relevant.length === 0) return { ok: false, reason: "Không có ảnh nào trong ngày này." };

  const members = await fetchAll<MemberRow>(
    (a, b) => db().from("members").select("id, username, exempt, left_at").order("id").range(a, b),
    "Load members",
  );
  const startIso = new Date(period.start).toISOString();
  const endIso = new Date(period.end).toISOString();

  const prev = must(
    await db()
      .from("evaluations")
      .select("id")
      .eq("superseded", false)
      .eq("period_kind", "daily")
      .lte("period_end", startIso)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Load previous evaluation",
  ) as { id: string } | null;
  const prevCounts = await previousCounts(prev?.id ?? null);

  const exemptKeys = new Set(cfg.exempt_usernames.map(usernameKey));
  const includedKeys = new Set(cfg.included_usernames.map(usernameKey));
  const summary: EvaluationSummary = { total: 0, PASS: 0, FAIL: 0, PENDING: 0, WARNING: 0, EXEMPT: 0, no_new_data: 0, km_total: 0, donate_total: 0 };
  const results = [];
  let lastUsed = 0;
  for (const m of members) {
    const points = pointsByMember.get(m.id);
    if (!points || points.length === 0) continue;
    // who belongs to this day:
    //  - left before the day started → no
    //  - left during a day that is still running → no (already kicked, nothing to decide any more)
    //  - joined after the day ended (first screenshot after it) → no
    if (m.left_at) {
      const leftMs = new Date(m.left_at).getTime();
      if (leftMs <= period.start || (now < period.end && leftMs <= now)) continue;
    }
    const firstSeen = Math.min(...points.map((p) => new Date(p.captured_at).getTime()));
    if (firstSeen > period.end) continue;
    const key = usernameKey(m.username);
    const r = evaluateMemberDaily(points, period, now, cfg, settings, {
      exempt: m.exempt || exemptKeys.has(key),
      inScope: cfg.applies_to_all || includedKeys.has(key),
    });
    if (!points.some((p) => { const ms = new Date(p.captured_at).getTime(); return ms >= period.start && ms <= period.end; })) {
      r.flags = [...r.flags, "no_new_data"];
    }
    if (r.to_captured_at) lastUsed = Math.max(lastUsed, new Date(r.to_captured_at).getTime());
    const prevCount = prevCounts.get(m.id) ?? 0;
    const consecutive = r.status === "FAIL" ? prevCount + 1 : r.status === "PENDING" ? prevCount : 0;
    summary.total++;
    summary[r.status as Status]++;
    if (r.flags.includes("no_new_data")) summary.no_new_data++;
    if (r.km.value) summary.km_total += r.km.value;
    if (r.donate.value) summary.donate_total += r.donate.value;
    results.push(resultRow(m, r, consecutive));
  }

  return saveEvaluation({
    set,
    settings,
    actor,
    trigger,
    summary,
    results,
    snapshotId,
    toCapturedAt: new Date(lastUsed || Math.min(now, period.end)).toISOString(),
    period: { kind: "daily", start: startIso, end: endIso, final: now >= period.end },
  });
}

async function runRolling(set: ActiveSet, settings: Settings, opts: { snapshotId?: string; actor: string; trigger: "auto" | "manual" }): Promise<RunResult> {
  const cfg = set.config;

  // ---- target snapshot ----
  const targetQuery = db().from("snapshots").select("id, captured_at, donate_type, next_reset_at");
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
        .select("id, captured_at, donate_type, next_reset_at")
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
    (a, b) => db().from("members").select("id, username, exempt, left_at").order("id").range(a, b),
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
      next_reset_at: s.next_reset_at,
    });
    pointsByMember.set(e.member_id, list);
  }

  // ---- previous evaluation (for consecutive violation counts) ----
  const prev = must(
    await db()
      .from("evaluations")
      .select("id")
      .eq("superseded", false)
      .eq("period_kind", "rolling")
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
    if (m.left_at && new Date(m.left_at).getTime() <= targetMs) continue; // already out of the crew
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

    results.push(resultRow(m, r, consecutive));
  }

  return saveEvaluation({
    set,
    settings,
    actor: opts.actor,
    trigger: opts.trigger,
    summary,
    results,
    snapshotId: target.id,
    toCapturedAt: target.captured_at,
    period: {
      kind: "rolling",
      start: new Date(targetMs - cfg.window_hours * 3600_000).toISOString(),
      end: target.captured_at,
      final: true,
    },
  });
}

function resultRow(m: MemberRow, r: ReturnType<typeof evaluateMember>, consecutive: number) {
  return {
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
  };
}

async function saveEvaluation(a: {
  set: ActiveSet;
  settings: Settings;
  actor: string;
  trigger: "auto" | "manual";
  summary: EvaluationSummary;
  results: ReturnType<typeof resultRow>[];
  snapshotId: string;
  toCapturedAt: string;
  period: { kind: "daily" | "rolling"; start: string; end: string; final: boolean };
}): Promise<RunResult> {
  const versionId = await ensureVersion(a.set, a.actor);

  // supersede previous runs for the same period / snapshot (they stay in history)
  const sup = db().from("evaluations").update({ superseded: true }).eq("superseded", false);
  must(
    a.period.kind === "daily"
      ? await sup.eq("period_kind", "daily").lt("period_start", a.period.end).gt("period_end", a.period.start)
      : await sup.eq("period_kind", "rolling").eq("to_snapshot_id", a.snapshotId),
    "Supersede old evaluations",
  );

  const evaluation = must(
    await db()
      .from("evaluations")
      .insert({
        requirement_version_id: versionId,
        requirement_name: `${a.set.name} (v${a.set.version})`,
        config: a.set.config,
        settings: a.settings,
        to_snapshot_id: a.snapshotId,
        to_captured_at: a.toCapturedAt,
        summary: a.summary,
        trigger: a.trigger,
        created_by: a.actor,
        period_kind: a.period.kind,
        period_start: a.period.start,
        period_end: a.period.end,
        is_final: a.period.final,
      })
      .select("id")
      .single(),
    "Create evaluation",
  ) as { id: string };

  try {
    for (const part of chunk(a.results, 500)) {
      must(
        await db().from("evaluation_results").insert(part.map((r) => ({ ...r, evaluation_id: evaluation.id }))),
        "Insert evaluation results",
      );
    }
  } catch (e) {
    await db().from("evaluations").delete().eq("id", evaluation.id);
    throw e;
  }

  await audit(a.actor, "evaluation.run", "evaluation", evaluation.id, {
    trigger: a.trigger,
    snapshot_id: a.snapshotId,
    requirement: `${a.set.name} v${a.set.version}`,
    period: a.period,
    summary: a.summary,
  });

  return { ok: true, evaluationId: evaluation.id, summary: a.summary };
}

/** Latest non-superseded evaluation (the "current" one — for daily periods: today, possibly still running). */
export async function getLatestEvaluation(opts: { finalOnly?: boolean } = {}) {
  let q = db().from("evaluations").select("*").eq("superseded", false);
  if (opts.finalOnly) q = q.eq("is_final", true);
  return must(
    await q
      .order("period_end", { ascending: false, nullsFirst: false })
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
  period_kind: "daily" | "rolling";
  period_start: string | null;
  period_end: string | null;
  is_final: boolean;
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
