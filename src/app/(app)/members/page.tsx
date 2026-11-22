import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { db, must } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getLatestEvaluation, type EvaluationRow, type ResultRow } from "@/lib/server/evaluation";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MembersTable, type MemberListRow } from "./members-table";
import { getSettings } from "@/lib/server/settings";
import { currentRaceWeek, weekContribution, type ContributionPoint } from "@/lib/engine/race";
import { WEEK_MS } from "@/lib/engine/week";

function nowMs() {
  return Date.now();
}

export const metadata = { title: "Members · Crew Manager" };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const [members, fails, current, settings, lastReset, firstSnap] = await Promise.all([
    fetchAll<{
      id: string;
      username: string;
      display_name: string | null;
      level: number | null;
      role: string | null;
      exempt: boolean;
      notes: string | null;
      last_seen_text: string | null;
      last_snapshot_at: string | null;
      left_at: string | null;
    }>(
      (a, b) =>
        db()
          .from("members")
          .select("id, username, display_name, level, role, exempt, notes, last_seen_text, last_snapshot_at, left_at")
          .order("username")
          .range(a, b),
      "Load members",
    ),
    fetchAll<{ member_id: string }>(
      (a, b) =>
        db()
          .from("evaluation_results")
          .select("member_id, evaluations!inner(superseded)")
          .eq("status", "FAIL")
          .eq("evaluations.superseded", false)
          .order("id")
          .range(a, b),
      "Load violations",
    ),
    // every verified value — used to compute what each member contributed in the selected race week
    fetchAll<{ member_id: string; weekly_km: number | null; donated: number | null; snapshots: { captured_at: string; donate_type: string } }>(
      (a, b) =>
        db()
          .from("snapshot_entries")
          .select("member_id, weekly_km, donated, snapshots!inner(captured_at, donate_type)")
          .eq("verified", true)
          .order("id")
          .range(a, b),
      "Load values",
    ),
    getSettings(),
    db()
      .from("snapshots")
      .select("next_reset_at")
      .not("next_reset_at", "is", null)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db().from("snapshots").select("captured_at").order("captured_at").limit(1).maybeSingle(),
  ]);

  // ---- which race week to show (0 = current, 1 = last week, …) ----
  const now = nowMs();
  const thisWeek = currentRaceWeek(now, (lastReset.data?.next_reset_at as string | undefined) ?? null, settings);
  const firstMs = firstSnap.data?.captured_at ? new Date(firstSnap.data.captured_at as string).getTime() : now;
  const maxBack = Math.max(0, Math.ceil((thisWeek.start - firstMs) / WEEK_MS));
  const back = Math.min(maxBack, Math.max(0, Math.floor(Number(sp.week) || 0)));
  const week = { start: thisWeek.start - back * WEEK_MS, end: thisWeek.end - back * WEEK_MS };
  const isCurrent = back === 0;

  // ---- contributions in that week (only screenshots taken before the week ended) ----
  const pointsBy = new Map<string, ContributionPoint[]>();
  for (const c of current) {
    if (new Date(c.snapshots.captured_at).getTime() > week.end) continue;
    const list = pointsBy.get(c.member_id) ?? [];
    list.push({
      captured_at: c.snapshots.captured_at,
      weekly_km: c.weekly_km === null ? null : Number(c.weekly_km),
      donated: c.donated === null ? null : Number(c.donated),
      donate_type: c.snapshots.donate_type === "weekly" ? "weekly" : "cumulative",
    });
    pointsBy.set(c.member_id, list);
  }
  const contributionBy = new Map([...pointsBy].map(([id, pts]) => [id, weekContribution(pts, week.start)]));

  // ---- status: current evaluation, or the last one of the selected past week ----
  const startIso = new Date(week.start).toISOString();
  const endIso = new Date(week.end).toISOString();
  const latest = isCurrent
    ? await getLatestEvaluation()
    : (must(
        await db()
          .from("evaluations")
          .select("*")
          .eq("superseded", false)
          .lte("period_end", endIso)
          .gte("period_end", startIso)
          .order("period_end", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "Load week evaluation",
      ) as EvaluationRow | null);

  const [results, dayResults] = await Promise.all([
    latest
      ? fetchAll<ResultRow>((a, b) => db().from("evaluation_results").select("*").eq("evaluation_id", latest.id).order("id").range(a, b), "Load results")
      : Promise.resolve([] as ResultRow[]),
    // finished days of this week → number of days passed / failed per member
    fetchAll<{ member_id: string; status: string }>(
      (a, b) =>
        db()
          .from("evaluation_results")
          .select("member_id, status, evaluations!inner(superseded, period_kind, is_final, period_start)")
          .eq("evaluations.superseded", false)
          .eq("evaluations.period_kind", "daily")
          .eq("evaluations.is_final", true)
          .gte("evaluations.period_start", startIso)
          .lt("evaluations.period_start", endIso)
          .order("id")
          .range(a, b),
      "Load daily results",
    ),
  ]);
  const days = new Map<string, { pass: number; fail: number }>();
  for (const d of dayResults) {
    const cur = days.get(d.member_id) ?? { pass: 0, fail: 0 };
    if (d.status === "PASS" || d.status === "EXEMPT") cur.pass++;
    if (d.status === "FAIL" || d.status === "WARNING") cur.fail++;
    days.set(d.member_id, cur);
  }

  const byMember = new Map(results.map((r) => [r.member_id, r]));
  const violationCount = new Map<string, number>();
  for (const f of fails) violationCount.set(f.member_id, (violationCount.get(f.member_id) ?? 0) + 1);

  const rows: MemberListRow[] = members.map((m) => {
    const r = byMember.get(m.id);
    const c = contributionBy.get(m.id);
    // for a past week, a member without any screenshot in that week has no data for it
    const absentPastWeek = !isCurrent && (!c || c.newWeekNoData);
    return {
      id: m.id,
      username: m.username,
      display_name: m.display_name,
      level: m.level,
      role: m.role,
      exempt: m.exempt,
      has_notes: !!m.notes,
      last_seen_text: m.last_seen_text,
      last_snapshot_at: m.last_snapshot_at,
      left_at: m.left_at,
      status: r?.status ?? null,
      km_gain: r?.km_gain === null || r?.km_gain === undefined ? null : Number(r.km_gain),
      km_exact: r?.km_gain_exact ?? null,
      donate_gain: r?.donate_gain === null || r?.donate_gain === undefined ? null : Number(r.donate_gain),
      donate_exact: r?.donate_gain_exact ?? null,
      reason: r?.reason_summary ?? null,
      no_new_data: !!r?.flags?.includes("no_new_data"),
      consecutive: r?.consecutive_fails ?? 0,
      violations: violationCount.get(m.id) ?? 0,
      current_km: absentPastWeek ? null : (c?.km ?? null),
      current_donated: absentPastWeek ? null : (c?.donate ?? null),
      donate_approx: c?.donateApprox ?? false,
      donate_since_first: c?.donateSinceFirst ?? false,
      donated_total: absentPastWeek ? null : (c?.donatedTotal ?? null),
      new_week_no_data: isCurrent && (c?.newWeekNoData ?? false),
      days_pass: days.get(m.id)?.pass ?? 0,
      days_fail: days.get(m.id)?.fail ?? 0,
    };
  });

  const weekLabel = back === 0 ? "Tuần đua hiện tại" : back === 1 ? "Tuần trước" : `${back} tuần trước`;

  return (
    <>
      <PageHeader
        title="Members"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/members?week=${back + 1}`}
              aria-disabled={back >= maxBack}
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), back >= maxBack && "pointer-events-none opacity-40")}
              title="Tuần trước"
            >
              <ChevronLeft />
            </Link>
            <div className="rounded-lg border bg-card px-3 py-2 text-xs">
              <div className="text-muted-foreground">
                {weekLabel}
                {thisWeek.fromCountdown ? " (theo đồng hồ trong game)" : " (theo Settings)"}
              </div>
              <div className="font-medium">
                {fmtDateTime(startIso)} → {fmtDateTime(endIso)}
              </div>
            </div>
            <Link
              href={back - 1 <= 0 ? "/members" : `/members?week=${back - 1}`}
              aria-disabled={isCurrent}
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), isCurrent && "pointer-events-none opacity-40")}
              title="Tuần sau"
            >
              <ChevronRight />
            </Link>
          </div>
        }
        description={
          latest
            ? latest.period_kind === "daily" && latest.period_start
              ? `${members.filter((m) => !m.left_at).length} thành viên trong crew · Trạng thái ngày ${fmtDateTime(latest.period_start)} → ${fmtDateTime(latest.period_end)}${latest.is_final ? " (đã chốt)" : " (đang diễn ra — cột tăng = tiến độ trong ngày)"} · ${latest.requirement_name}`
              : `${members.length} thành viên · Trạng thái theo lần đánh giá ${fmtDateTime(latest.to_captured_at)} (${latest.requirement_name})`
            : `${members.length} thành viên · ${isCurrent ? "Chưa có lần đánh giá nào" : "Tuần này không có lần đánh giá nào"}`
        }
      />
      <MembersTable rows={rows} pastWeek={!isCurrent} />
    </>
  );
}
