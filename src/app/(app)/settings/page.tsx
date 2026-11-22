import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { db, must } from "@/lib/server/supabase";
import { getSettings } from "@/lib/server/settings";
import { env } from "@/lib/server/env";
import { requireManager } from "@/lib/server/session";
import { fmtDateTime } from "@/lib/format";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings · Crew Manager" };

const ACTION_LABEL: Record<string, string> = {
  login: "Đăng nhập",
  "snapshot.create": "Upload snapshot",
  "snapshot.delete": "Xóa snapshot",
  "entry.update": "Sửa dữ liệu thành viên",
  "evaluation.run": "Chạy đánh giá",
  "requirement.create": "Tạo bộ điều kiện",
  "requirement.update": "Sửa bộ điều kiện",
  "requirement.activate": "Áp dụng bộ điều kiện",
  "requirement.delete": "Xóa bộ điều kiện",
  "member.exempt": "Miễn điều kiện",
  "member.unexempt": "Bỏ miễn điều kiện",
  "member.notes": "Sửa ghi chú",
  "member.merge": "Gộp thành viên",
  "member.delete": "Xóa thành viên",
  "violation.resolve": "Xử lý vi phạm",
  "violation.reopen": "Mở lại vi phạm",
  "violation.export": "Xuất danh sách vi phạm",
  "settings.update": "Sửa cài đặt",
};

const PAGE = 100;

function summarize(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "snapshot.create":
      return `${d.members} thành viên, ${d.unverified} chưa xác thực, ${d.images} ảnh`;
    case "entry.update":
      return `${d.username}: ${Object.keys((d.changed as object) ?? {}).join(", ") || "không đổi"}`;
    case "evaluation.run": {
      const s = d.summary as Record<string, number> | undefined;
      return `${d.requirement ?? ""} · ${s ? `${s.PASS} PASS / ${s.FAIL} FAIL / ${s.PENDING} PENDING` : ""} (${d.trigger})`;
    }
    case "member.merge":
      return `${d.from} → ${d.into} (${d.entries_moved} dòng)`;
    case "violation.resolve":
    case "violation.reopen":
      return `${d.count} vi phạm: ${((d.usernames as string[]) ?? []).slice(0, 5).join(", ")}${d.note ? ` — ${d.note}` : ""}`;
    case "violation.export":
      return `${String(d.format).toUpperCase()} · ${d.count} dòng`;
    default:
      return [d.name, d.username, d.version ? `v${d.version}` : null, d.reason].filter(Boolean).join(" · ");
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ page?: string; actor?: string }> }) {
  const manager = await requireManager();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const settings = await getSettings();

  let q = db().from("audit_logs").select("*", { count: "exact" });
  if (sp.actor) q = q.eq("actor", sp.actor);
  const res = await q.order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const logs = must(res, "Load audit log") as { id: number; created_at: string; actor: string; action: string; entity_type: string | null; entity_id: string | null; details: Record<string, unknown> }[];
  const total = res.count ?? logs.length;
  const managers = env.managers.map((m) => m.name);

  return (
    <>
      <PageHeader title="Settings" description="Cài đặt chung cho cả hai quản lý và nhật ký thao tác." />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <SettingsForm initial={settings} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hệ thống</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Bạn</dt>
                <dd className="font-medium">{manager}</dd>
                <dt className="text-muted-foreground">Quản lý</dt>
                <dd>{managers.join(", ")}</dd>
                <dt className="text-muted-foreground">OCR model</dt>
                <dd className="font-mono text-xs">{env.ocrModel}</dd>
                <dt className="text-muted-foreground">AI Gateway</dt>
                <dd>{process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ? "Đã cấu hình" : <span className="text-warning">Chưa có key</span>}</dd>
                <dt className="text-muted-foreground">Storage bucket</dt>
                <dd className="font-mono text-xs">{env.storageBucket}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Tài khoản quản lý và API key được cấu hình bằng Environment Variables trên Vercel (không lưu trong database).</p>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden p-0">
          <CardHeader className="px-4 pt-4">
            <CardTitle className="text-base">Nhật ký thao tác</CardTitle>
            <CardDescription className="flex flex-wrap gap-2">
              <Link href="/settings" className={buttonVariants({ variant: sp.actor ? "ghost" : "secondary", size: "xs" })}>
                Tất cả
              </Link>
              {managers.map((m) => (
                <Link key={m} href={`/settings?actor=${encodeURIComponent(m)}`} className={buttonVariants({ variant: sp.actor === m ? "secondary" : "ghost", size: "xs" })}>
                  {m}
                </Link>
              ))}
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Thời gian</th>
                  <th className="px-4 py-2 text-left font-medium">Quản lý</th>
                  <th className="px-4 py-2 text-left font-medium">Thao tác</th>
                  <th className="px-4 py-2 text-left font-medium">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{fmtDateTime(l.created_at)}</td>
                    <td className="px-4 py-2 font-medium">{l.actor}</td>
                    <td className="px-4 py-2">
                      {l.entity_type === "snapshot" && l.entity_id && l.action !== "snapshot.delete" ? (
                        <Link href={`/snapshots/${l.entity_id}`} className="text-primary hover:underline">
                          {ACTION_LABEL[l.action] ?? l.action}
                        </Link>
                      ) : (
                        (ACTION_LABEL[l.action] ?? l.action)
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      <details>
                        <summary className="cursor-pointer">{summarize(l.action, l.details ?? {}) || "Xem"}</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify(l.details, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Chưa có thao tác nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="flex justify-center gap-2 border-t p-3 text-sm">
              {page > 1 && (
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/settings?page=${page - 1}${sp.actor ? `&actor=${encodeURIComponent(sp.actor)}` : ""}`}>
                  ← Mới hơn
                </Link>
              )}
              <span className="px-2 py-1 text-muted-foreground">
                Trang {page}/{Math.ceil(total / PAGE)}
              </span>
              {page * PAGE < total && (
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/settings?page=${page + 1}${sp.actor ? `&actor=${encodeURIComponent(sp.actor)}` : ""}`}>
                  Cũ hơn →
                </Link>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
