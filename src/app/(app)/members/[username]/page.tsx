import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/status-badge";
import { db, must } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getSettings } from "@/lib/server/settings";
import { usernameKey } from "@/lib/engine/parse";
import { resetBetween } from "@/lib/engine/week";
import { fmtDateTime, fmtGain, fmtHours, fmtNum } from "@/lib/format";
import type { ResultRow } from "@/lib/server/evaluation";
import { MemberHistoryChart } from "./history-chart";
import { MemberProfileActions } from "./profile-actions";

interface EntryWithSnap {
  id: string;
  snapshot_id: string;
  display_name: string | null;
  level: number | null;
  role: string | null;
  weekly_km: number | null;
  donated: number | null;
  last_seen_text: string | null;
  verified: boolean;
  snapshots: { captured_at: string; donate_type: string; next_reset_at: string | null };
}

export default async function MemberDetail({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const key = usernameKey(decodeURIComponent(username));
  const member = must(await db().from("members").select("*").eq("username_key", key).maybeSingle(), "Load member") as {
    id: string;
    username: string;
    display_name: string | null;
    level: number | null;
    role: string | null;
    last_seen_text: string | null;
    exempt: boolean;
    exempt_reason: string | null;
    notes: string | null;
    first_seen_at: string | null;
    last_snapshot_at: string | null;
  } | null;
  if (!member) notFound();

  const [entriesRaw, results, settings] = await Promise.all([
    fetchAll<EntryWithSnap>(
      (a, b) =>
        db()
          .from("snapshot_entries")
          .select("id, snapshot_id, display_name, level, role, weekly_km, donated, last_seen_text, verified, snapshots!inner(captured_at, donate_type, next_reset_at)")
          .eq("member_id", member.id)
          .order("id")
          .range(a, b),
      "Load history",
    ),
    fetchAll<ResultRow & { evaluations: { requirement_name: string; superseded: boolean } }>(
      (a, b) =>
        db()
          .from("evaluation_results")
          .select("*, evaluations!inner(requirement_name, superseded)")
          .eq("member_id", member.id)
          .order("created_at", { ascending: false })
          .range(a, b),
      "Load evaluations",
    ),
    getSettings(),
  ]);

  const entries = entriesRaw
    .map((e) => ({
      ...e,
      weekly_km: e.weekly_km === null ? null : Number(e.weekly_km),
      donated: e.donated === null ? null : Number(e.donated),
    }))
    .sort((a, b) => a.snapshots.captured_at.localeCompare(b.snapshots.captured_at));

  // pairwise comparison between consecutive verified snapshots
  type Cmp = (typeof entries)[number] & { dKm: number | null; dDon: number | null; hours: number | null; note: string[] };
  const comparisons: Cmp[] = [];
  let prev: (typeof entries)[number] | null = null;
  for (const e of entries) {
    const note: string[] = [];
    let dKm: number | null = null;
    let dDon: number | null = null;
    let hours: number | null = null;
    if (!e.verified) note.push("Chưa xác thực — không dùng để so sánh");
    if (prev && e.verified) {
      const ta = new Date(prev.snapshots.captured_at).getTime();
      const tb = new Date(e.snapshots.captured_at).getTime();
      hours = (tb - ta) / 3600_000;
      const reset = resetBetween({ ms: ta, next_reset_at: prev.snapshots.next_reset_at }, { ms: tb, next_reset_at: e.snapshots.next_reset_at }, settings);
      if (prev.weekly_km !== null && e.weekly_km !== null) {
        if (reset) {
          dKm = e.weekly_km;
          note.push("Qua mốc reset tuần: KM tăng ≥ giá trị mới");
        } else if (e.weekly_km < prev.weekly_km) {
          dKm = e.weekly_km;
          note.push("KM giảm bất thường");
        } else dKm = e.weekly_km - prev.weekly_km;
      }
      if (prev.donated !== null && e.donated !== null) {
        if (prev.snapshots.donate_type !== e.snapshots.donate_type) note.push("Loại Donate khác nhau");
        else if (e.snapshots.donate_type === "weekly" && reset) {
          dDon = e.donated;
          note.push("Donate tuần đã reset");
        } else if (e.donated < prev.donated) note.push("Donate giảm bất thường");
        else dDon = e.donated - prev.donated;
      }
    }
    comparisons.push({ ...e, dKm, dDon, hours, note });
    if (e.verified) prev = e;
  }

  const chartData = entries
    .filter((e) => e.verified)
    .map((e) => ({ t: e.snapshots.captured_at, km: e.weekly_km, donated: e.donated }));
  const current = results.find((r) => !r.evaluations.superseded);
  const activeResults = results.filter((r) => !r.evaluations.superseded);
  const violations = activeResults.filter((r) => r.status === "FAIL");

  return (
    <>
      <Link href="/members" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Members
      </Link>
      <PageHeader
        title={member.username}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {member.display_name && <span>{member.display_name}</span>}
            {member.role && <span>· {member.role}</span>}
            {member.level !== null && <span>· Level {member.level}</span>}
            <StatusBadge status={current?.status} />
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lịch sử Weekly KM & Donate</CardTitle>
              <CardDescription>Giá trị đọc được ở từng snapshot (đã xác thực). Weekly KM giảm về thấp là do reset đầu tuần.</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? <MemberHistoryChart data={chartData} /> : <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>}
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">So sánh từng Snapshot</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Snapshot</th>
                    <th className="px-4 py-2 text-right font-medium">Weekly KM</th>
                    <th className="px-4 py-2 text-right font-medium">Δ KM</th>
                    <th className="px-4 py-2 text-right font-medium">Donated</th>
                    <th className="px-4 py-2 text-right font-medium">Δ Donate</th>
                    <th className="px-4 py-2 text-right font-medium">Khoảng cách</th>
                    <th className="px-4 py-2 text-right font-medium">KM/ngày</th>
                    <th className="px-4 py-2 text-left font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {[...comparisons].reverse().map((c) => (
                    <tr key={c.id} className={`border-t ${c.verified ? "" : "bg-warning/5"}`}>
                      <td className="px-4 py-2">
                        <Link href={`/snapshots/${c.snapshot_id}`} className="text-primary hover:underline">
                          {fmtDateTime(c.snapshots.captured_at)}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right tabular">{c.weekly_km === null ? "Chưa rõ" : fmtNum(c.weekly_km)}</td>
                      <td className="px-4 py-2 text-right tabular">
                        {c.dKm === null ? "—" : <span className="text-success">+{fmtNum(c.dKm)}</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular">{c.donated === null ? "Chưa rõ" : fmtNum(c.donated)}</td>
                      <td className="px-4 py-2 text-right tabular">
                        {c.dDon === null ? "—" : <span className="text-success">+{fmtNum(c.dDon)}</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">{c.hours === null ? "—" : fmtHours(c.hours)}</td>
                      <td className="px-4 py-2 text-right tabular">
                        {c.dKm !== null && c.hours ? fmtNum((c.dKm / c.hours) * 24) : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-warning">{c.note.join("; ")}</td>
                    </tr>
                  ))}
                  {comparisons.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Chưa có snapshot nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Lịch sử đánh giá ({violations.length} lần vi phạm)</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Thời điểm</th>
                    <th className="px-4 py-2 text-left font-medium">Trạng thái</th>
                    <th className="px-4 py-2 text-right font-medium">KM tăng / yêu cầu</th>
                    <th className="px-4 py-2 text-right font-medium">Donate tăng / yêu cầu</th>
                    <th className="px-4 py-2 text-left font-medium">Lý do</th>
                    <th className="px-4 py-2 text-left font-medium">Bộ điều kiện</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className={`border-t align-top ${r.evaluations.superseded ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2 text-xs">
                        {fmtDateTime(r.to_captured_at ?? r.created_at)}
                        <div className="text-muted-foreground">{r.hours ? `trong ${fmtHours(r.hours)}` : ""}</div>
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                        {r.resolved && <div className="mt-1 text-[11px] text-success">Đã xử lý</div>}
                      </td>
                      <td className="px-4 py-2 text-right tabular text-xs">
                        {fmtGain(r.km_gain, r.km_gain_exact)} / {fmtNum(r.km_required)}
                      </td>
                      <td className="px-4 py-2 text-right tabular text-xs">
                        {fmtGain(r.donate_gain, r.donate_gain_exact)} / {fmtNum(r.donate_required)}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div>{r.reason_summary}</div>
                        {r.status !== "PASS" &&
                          r.reasons.map((x, i) => (
                            <div key={i} className="text-muted-foreground">
                              • {x}
                            </div>
                          ))}
                        {r.resolution_note && <div className="mt-1 text-success">Xử lý: {r.resolution_note}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {r.evaluations.requirement_name}
                        {r.evaluations.superseded && " (đã thay thế)"}
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Chưa có lần đánh giá nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hồ sơ</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Username</dt>
                <dd className="font-mono">{member.username}</dd>
                <dt className="text-muted-foreground">Display</dt>
                <dd>{member.display_name ?? "—"}</dd>
                <dt className="text-muted-foreground">Level</dt>
                <dd>{fmtNum(member.level)}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{member.role ?? "—"}</dd>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd>{member.last_seen_text ?? "—"}</dd>
                <dt className="text-muted-foreground">Lần đầu</dt>
                <dd>{fmtDateTime(member.first_seen_at)}</dd>
                <dt className="text-muted-foreground">Gần nhất</dt>
                <dd>{fmtDateTime(member.last_snapshot_at)}</dd>
                <dt className="text-muted-foreground">Snapshots</dt>
                <dd>{entries.length}</dd>
                <dt className="text-muted-foreground">Vi phạm</dt>
                <dd className={violations.length ? "text-destructive" : ""}>
                  {violations.length}
                  {current && current.consecutive_fails > 0 && ` (${current.consecutive_fails} liên tiếp)`}
                </dd>
              </dl>
            </CardContent>
          </Card>
          <MemberProfileActions
            memberId={member.id}
            username={member.username}
            exempt={member.exempt}
            exemptReason={member.exempt_reason}
            notes={member.notes}
          />
        </div>
      </div>
    </>
  );
}
