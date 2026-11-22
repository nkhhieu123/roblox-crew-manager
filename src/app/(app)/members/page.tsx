import { PageHeader } from "@/components/app/page-header";
import { db } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getLatestEvaluation, type ResultRow } from "@/lib/server/evaluation";
import { fmtDateTime } from "@/lib/format";
import { MembersTable, type MemberListRow } from "./members-table";

export const metadata = { title: "Members · Crew Manager" };

export default async function MembersPage() {
  const [members, latest, fails, current] = await Promise.all([
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
    }>(
      (a, b) =>
        db()
          .from("members")
          .select("id, username, display_name, level, role, exempt, notes, last_seen_text, last_snapshot_at")
          .order("username")
          .range(a, b),
      "Load members",
    ),
    getLatestEvaluation(),
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
    // latest verified values per member = what they have contributed so far (KM this week, total Donated)
    fetchAll<{ member_id: string; weekly_km: number | null; donated: number | null; snapshots: { captured_at: string } }>(
      (a, b) =>
        db()
          .from("snapshot_entries")
          .select("member_id, weekly_km, donated, snapshots!inner(captured_at)")
          .eq("verified", true)
          .order("id")
          .range(a, b),
      "Load current values",
    ),
  ]);
  const currentBy = new Map<string, { km: number | null; donated: number | null; at: string }>();
  for (const c of current) {
    const prev = currentBy.get(c.member_id);
    if (prev && prev.at >= c.snapshots.captured_at) continue;
    currentBy.set(c.member_id, {
      km: c.weekly_km === null ? null : Number(c.weekly_km),
      donated: c.donated === null ? null : Number(c.donated),
      at: c.snapshots.captured_at,
    });
  }

  const results = latest
    ? await fetchAll<ResultRow>(
        (a, b) => db().from("evaluation_results").select("*").eq("evaluation_id", latest.id).order("id").range(a, b),
        "Load results",
      )
    : [];
  const byMember = new Map(results.map((r) => [r.member_id, r]));
  const violationCount = new Map<string, number>();
  for (const f of fails) violationCount.set(f.member_id, (violationCount.get(f.member_id) ?? 0) + 1);

  const rows: MemberListRow[] = members.map((m) => {
    const r = byMember.get(m.id);
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
      status: r?.status ?? null,
      km_gain: r?.km_gain === null || r?.km_gain === undefined ? null : Number(r.km_gain),
      km_exact: r?.km_gain_exact ?? null,
      donate_gain: r?.donate_gain === null || r?.donate_gain === undefined ? null : Number(r.donate_gain),
      donate_exact: r?.donate_gain_exact ?? null,
      reason: r?.reason_summary ?? null,
      no_new_data: !!r?.flags?.includes("no_new_data"),
      consecutive: r?.consecutive_fails ?? 0,
      violations: violationCount.get(m.id) ?? 0,
      current_km: currentBy.get(m.id)?.km ?? null,
      current_donated: currentBy.get(m.id)?.donated ?? null,
    };
  });

  return (
    <>
      <PageHeader
        title="Members"
        description={
          latest
            ? `${members.length} thành viên · Trạng thái theo lần đánh giá ${fmtDateTime(latest.to_captured_at)} (${latest.requirement_name})`
            : `${members.length} thành viên · Chưa có lần đánh giá nào`
        }
      />
      <MembersTable rows={rows} />
    </>
  );
}
