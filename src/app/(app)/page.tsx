import Link from "next/link";
import { AlertTriangle, Clock, Coins, Footprints, ShieldAlert, ShieldCheck, Upload, Users, HelpCircle, Hourglass } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/status-badge";
import { db, must } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getLatestEvaluation, type ResultRow } from "@/lib/server/evaluation";
import { getActiveRequirement } from "@/lib/server/requirements";
import { dailyActivity } from "@/lib/server/dashboard";
import { fmtDate, fmtDateTime, fmtGain, fmtNum, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DailyCharts, PassRateChart, TopMembersChart } from "./dashboard-charts";

export const metadata = { title: "Dashboard · Crew Manager" };

function periodHint(e: { period_kind?: string; period_start?: string | null; is_final?: boolean; config: { window_hours: number } }) {
  if (e.period_kind === "daily" && e.period_start) {
    return `ngày ${fmtDate(e.period_start)}${e.is_final ? "" : " (đang diễn ra)"}`;
  }
  return `trong chu kỳ ${e.config.window_hours}h gần nhất`;
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "destructive" | "warning" | "info" | "primary";
  hint?: React.ReactNode;
  href?: string;
}) {
  const color = {
    success: "text-success bg-success/10",
    destructive: "text-destructive bg-destructive/10",
    warning: "text-warning bg-warning/10",
    info: "text-info bg-info/10",
    primary: "text-primary bg-primary/10",
  }[tone ?? "primary"];
  const body = (
    <Card className={cn("h-full", href && "transition-colors hover:bg-muted/30")}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("rounded-lg p-2", color)}>
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const [memberCount, latestSnap, latest, active, daily, evalHistory] = await Promise.all([
    db().from("members").select("id", { count: "exact", head: true }).is("left_at", null),
    db().from("snapshots").select("id, captured_at, uploaded_by, member_count").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    getLatestEvaluation(),
    getActiveRequirement(),
    dailyActivity(30),
    db()
      .from("evaluations")
      .select("to_captured_at, summary")
      .eq("superseded", false)
      .order("to_captured_at", { ascending: false })
      .limit(30),
  ]);

  const results = latest
    ? await fetchAll<ResultRow>(
        (a, b) => db().from("evaluation_results").select("*").eq("evaluation_id", latest.id).order("id").range(a, b),
        "Load results",
      )
    : [];
  const s = latest?.summary;
  const snap = must(latestSnap, "Load latest snapshot") as { id: string; captured_at: string; uploaded_by: string; member_count: number } | null;

  const topKm = results
    .filter((r) => r.km_gain !== null && Number(r.km_gain) > 0)
    .sort((a, b) => Number(b.km_gain) - Number(a.km_gain))
    .slice(0, 10)
    .map((r) => ({ username: r.username, value: Number(r.km_gain) }));
  const topDonate = results
    .filter((r) => r.donate_gain !== null && Number(r.donate_gain) > 0)
    .sort((a, b) => Number(b.donate_gain) - Number(a.donate_gain))
    .slice(0, 10)
    .map((r) => ({ username: r.username, value: Number(r.donate_gain) }));
  const passHistory = (evalHistory.data ?? [])
    .map((e) => ({ t: e.to_captured_at as string, ...(e.summary as Record<string, number>) }))
    .reverse();
  const worst = results
    .filter((r) => r.status === "FAIL")
    .sort((a, b) => b.consecutive_fails - a.consecutive_fails)
    .slice(0, 8);

  const evaluated = s ? s.total - s.EXEMPT : 0;
  const passRate = s && evaluated > 0 ? Math.round((s.PASS / evaluated) * 100) : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          active ? (
            <>
              Bộ điều kiện đang áp dụng: <b>{active.name}</b> (v{active.version}, {active.config.period === "daily" ? "đánh giá theo ngày 00:00 → 00:00" : `chu kỳ ${active.config.window_hours}h`})
            </>
          ) : (
            <span className="text-warning">
              Chưa có bộ điều kiện. <Link href="/requirements/new" className="underline">Tạo ngay</Link> để bắt đầu đánh giá.
            </span>
          )
        }
        actions={
          <Link href="/upload" className={buttonVariants()}>
            <Upload /> Upload Screenshot
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        <Stat label="Tổng thành viên" value={fmtNum(memberCount.count ?? 0)} icon={Users} href="/members" hint={s ? `${s.total} được đánh giá` : undefined} />
        <Stat label="PASS" value={fmtNum(s?.PASS ?? 0)} icon={ShieldCheck} tone="success" hint={passRate !== null ? `${passRate}% đạt yêu cầu` : undefined} />
        <Stat label="FAIL" value={fmtNum(s?.FAIL ?? 0)} icon={ShieldAlert} tone="destructive" href="/violations" hint={s?.WARNING ? `+ ${s.WARNING} WARNING` : undefined} />
        <Stat label="PENDING" value={fmtNum(s?.PENDING ?? 0)} icon={HelpCircle} tone="warning" hint="Chưa đủ dữ liệu" />
        <Stat label="Chưa có dữ liệu mới" value={fmtNum(s?.no_new_data ?? 0)} icon={Hourglass} tone="info" hint="Không có trong snapshot mới nhất" />
        <Stat label="Tổng KM phát sinh" value={fmtNum(s?.km_total ?? 0)} icon={Footprints} hint={latest ? periodHint(latest) : undefined} />
        <Stat label="Tổng Donate phát sinh" value={fmtNum(s?.donate_total ?? 0)} icon={Coins} hint={latest ? periodHint(latest) : undefined} />
        <Stat
          label="Snapshot gần nhất"
          value={<span className="text-base">{snap ? fmtDateTime(snap.captured_at) : "—"}</span>}
          icon={Clock}
          href={snap ? `/snapshots/${snap.id}` : "/upload"}
          hint={snap ? `${timeAgo(snap.captured_at)} · ${snap.uploaded_by} · ${snap.member_count} người` : "Chưa có snapshot"}
        />
      </div>

      {!snap && (
        <Card className="mt-6">
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">Chưa có dữ liệu. Bắt đầu bằng cách tải ảnh danh sách Members lên.</p>
            <Link href="/upload" className={cn(buttonVariants(), "mt-4")}>
              <Upload /> Upload ảnh đầu tiên
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tổng KM từng ngày</CardTitle>
            <CardDescription>30 ngày gần nhất, tính từ chênh lệch giữa các snapshot (KM sau reset tính tối thiểu).</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyCharts data={daily} metric="km" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tổng Donate từng ngày</CardTitle>
            <CardDescription>30 ngày gần nhất.</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyCharts data={daily} metric="donate" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hoạt động của Crew theo ngày</CardTitle>
            <CardDescription>Số thành viên có KM hoặc Donate tăng trong ngày.</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyCharts data={daily} metric="active" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tỷ lệ thành viên đạt yêu cầu</CardTitle>
            <CardDescription>Theo từng lần đánh giá (không tính EXEMPT).</CardDescription>
          </CardHeader>
          <CardContent>
            <PassRateChart data={passHistory} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top KM — lần đánh giá gần nhất</CardTitle>
          </CardHeader>
          <CardContent>
            <TopMembersChart data={topKm} color="var(--chart-1)" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Donate — lần đánh giá gần nhất</CardTitle>
          </CardHeader>
          <CardContent>
            <TopMembersChart data={topDonate} color="var(--chart-2)" />
          </CardContent>
        </Card>
      </div>

      {worst.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" /> Cần xử lý
            </CardTitle>
            <CardDescription>
              <Link href="/violations" className="text-primary hover:underline">
                Xem toàn bộ Violations →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {worst.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <StatusBadge status={r.status} />
                <Link href={`/members/${encodeURIComponent(r.username)}`} className="font-mono text-xs text-primary hover:underline">
                  {r.username}
                </Link>
                <span className="text-muted-foreground">{r.reason_summary}</span>
                <span className="text-xs text-muted-foreground">
                  KM {fmtGain(r.km_gain, r.km_gain_exact)} · Donate {fmtGain(r.donate_gain, r.donate_gain_exact)}
                </span>
                {r.consecutive_fails > 1 && <span className="text-xs text-destructive">{r.consecutive_fails} lần liên tiếp</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
