import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, must } from "@/lib/server/supabase";
import { env } from "@/lib/server/env";
import { fetchAll } from "@/lib/server/fetch-all";
import { fmtDateTime } from "@/lib/format";
import { EntriesTable, type EntryRow } from "./entries-table";
import { SnapshotActions } from "./snapshot-actions";

export default async function SnapshotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const snap = must(await db().from("snapshots").select("*").eq("id", id).maybeSingle(), "Load snapshot") as {
    id: string;
    captured_at: string;
    uploaded_at: string;
    uploaded_by: string;
    donate_type: string;
    image_paths: string[];
    member_count: number;
    ocr_model: string | null;
    notes: string | null;
    next_reset_at: string | null;
    reset_countdown_text: string | null;
  } | null;
  if (!snap) notFound();

  const [entries, evals, signed] = await Promise.all([
    fetchAll<EntryRow>(
      (a, b) =>
        db()
          .from("snapshot_entries")
          .select("id, member_id, username, display_name, level, role, weekly_km, donated, last_seen_text, needs_review, verified, review_notes")
          .eq("snapshot_id", id)
          .order("username")
          .range(a, b),
      "Load entries",
    ),
    db()
      .from("evaluations")
      .select("id, requirement_name, summary, superseded, trigger, created_by, created_at")
      .eq("to_snapshot_id", id)
      .order("created_at", { ascending: false }),
    snap.image_paths.length
      ? db().storage.from(env.storageBucket).createSignedUrls(snap.image_paths, 3600)
      : Promise.resolve({ data: [] as { signedUrl: string | null }[], error: null }),
  ]);

  const images = (signed.data ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  const unverified = entries.filter((e) => !e.verified).length;

  return (
    <>
      <Link href="/snapshots" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Snapshots
      </Link>
      <PageHeader
        title={`Snapshot ${fmtDateTime(snap.captured_at)}`}
        description={
          <>
            Upload lúc {fmtDateTime(snap.uploaded_at)} bởi <b>{snap.uploaded_by}</b> · {snap.member_count} thành viên ·
            Donate: {snap.donate_type === "weekly" ? "theo tuần" : "tích lũy"}
            {snap.ocr_model && <> · OCR: {snap.ocr_model}</>}
            <br />
            Reset KM tiếp theo:{" "}
            {snap.next_reset_at ? (
              <b>
                {fmtDateTime(snap.next_reset_at)}
                {snap.reset_countdown_text && <span className="font-normal"> (đồng hồ: {snap.reset_countdown_text})</span>}
              </b>
            ) : (
              "không có đồng hồ trong ảnh — dùng mốc trong Settings"
            )}
          </>
        }
        actions={<SnapshotActions snapshotId={snap.id} capturedAt={fmtDateTime(snap.captured_at)} memberCount={snap.member_count} />}
      />

      {snap.notes && <p className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">{snap.notes}</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden p-0">
          <CardHeader className="px-4 pt-4">
            <CardTitle className="text-base">
              Dữ liệu thành viên{" "}
              {unverified > 0 && <span className="text-sm font-normal text-warning">· {unverified} dòng chưa xác thực (không dùng để so sánh)</span>}
            </CardTitle>
          </CardHeader>
          <EntriesTable entries={entries} />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lần đánh giá</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(evals.data ?? []).length === 0 && <p className="text-muted-foreground">Chưa có.</p>}
              {(evals.data ?? []).map((e) => {
                const s = e.summary as Record<string, number>;
                return (
                  <div key={e.id} className={e.superseded ? "opacity-50" : ""}>
                    <div className="font-medium">
                      {e.requirement_name} {e.superseded && <span className="text-xs">(đã thay thế)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDateTime(e.created_at)} · {e.created_by} · {e.trigger === "auto" ? "tự động" : "thủ công"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="text-success">{s.PASS} PASS</span>
                      <span className="text-destructive">{s.FAIL} FAIL</span>
                      <span className="text-warning">{s.WARNING} WARN</span>
                      <span className="text-muted-foreground">{s.PENDING} PENDING</span>
                      <span className="text-info">{s.EXEMPT} EXEMPT</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ảnh gốc</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {images.length === 0 && <p className="text-sm text-muted-foreground">Không lưu ảnh cho snapshot này.</p>}
              {images.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${i + 1}`} className="w-full" />
                </a>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
