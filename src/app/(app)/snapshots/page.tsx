import Link from "next/link";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db, must } from "@/lib/server/supabase";
import { fmtDateTime, timeAgo } from "@/lib/format";

export const metadata = { title: "Snapshots · Crew Manager" };

interface Row {
  id: string;
  captured_at: string;
  uploaded_at: string;
  uploaded_by: string;
  donate_type: string;
  member_count: number;
  image_paths: string[];
  notes: string | null;
}

const PAGE = 50;

export default async function SnapshotsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const res = await db()
    .from("snapshots")
    .select("id, captured_at, uploaded_at, uploaded_by, donate_type, member_count, image_paths, notes", { count: "exact" })
    .order("captured_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const rows = must(res, "Load snapshots") as Row[];
  const total = res.count ?? rows.length;

  const { data: evals } = await db()
    .from("evaluations")
    .select("to_snapshot_id, summary")
    .eq("superseded", false)
    .in("to_snapshot_id", rows.map((r) => r.id).length ? rows.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]);
  const evalBySnap = new Map((evals ?? []).map((e) => [e.to_snapshot_id as string, e.summary as Record<string, number>]));

  return (
    <>
      <PageHeader
        title="Snapshots History"
        description={`${total} snapshot đã lưu. Không snapshot nào bị xóa tự động.`}
        actions={
          <Link href="/upload" className={buttonVariants()}>
            <Upload /> Upload mới
          </Link>
        }
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Thời điểm dữ liệu</th>
                <th className="px-4 py-2.5 text-left font-medium">Upload</th>
                <th className="px-4 py-2.5 text-left font-medium">Người upload</th>
                <th className="px-4 py-2.5 text-right font-medium">Thành viên</th>
                <th className="px-4 py-2.5 text-left font-medium">Donate</th>
                <th className="px-4 py-2.5 text-left font-medium">Kết quả đánh giá</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = evalBySnap.get(r.id);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <Link href={`/snapshots/${r.id}`} className="font-medium text-primary hover:underline">
                        {fmtDateTime(r.captured_at)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{timeAgo(r.captured_at)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDateTime(r.uploaded_at)}</td>
                    <td className="px-4 py-2.5">{r.uploaded_by}</td>
                    <td className="px-4 py-2.5 text-right tabular">{r.member_count}</td>
                    <td className="px-4 py-2.5 text-xs">{r.donate_type === "weekly" ? "Theo tuần" : "Tích lũy"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {s ? (
                        <span className="flex flex-wrap gap-2">
                          <span className="text-success">{s.PASS} PASS</span>
                          <span className="text-destructive">{s.FAIL} FAIL</span>
                          <span className="text-warning">{s.WARNING} WARN</span>
                          <span className="text-muted-foreground">{s.PENDING} PENDING</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Chưa đánh giá</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    Chưa có snapshot nào. <Link href="/upload" className="text-primary hover:underline">Upload ảnh đầu tiên</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {total > PAGE && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          {page > 1 && (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/snapshots?page=${page - 1}`}>
              ← Trước
            </Link>
          )}
          <span className="px-2 py-1 text-muted-foreground">
            Trang {page}/{Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total && (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/snapshots?page=${page + 1}`}>
              Sau →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
