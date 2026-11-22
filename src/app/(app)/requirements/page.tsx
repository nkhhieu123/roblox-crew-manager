import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { db, must } from "@/lib/server/supabase";
import { normalizeConfig, type RequirementSetRow } from "@/lib/server/requirements";
import { buildRuleTree, describeTree } from "@/lib/engine/rules";
import { fmtDateTime, fmtHours, fmtNum } from "@/lib/format";
import { SetActions } from "./set-actions";

export const metadata = { title: "Requirements · Crew Manager" };

const MODE_LABEL = { ANY: "ANY — đạt ít nhất 1", ALL: "ALL — đạt tất cả", CUSTOM: "CUSTOM — tùy chỉnh" } as const;

export default async function RequirementsPage() {
  const sets = (must(
    await db().from("requirement_sets").select("*").order("is_active", { ascending: false }).order("updated_at", { ascending: false }),
    "Load requirement sets",
  ) as RequirementSetRow[]).map((s) => ({ ...s, config: normalizeConfig(s.config) }));

  const { data: versions } = await db()
    .from("requirement_versions")
    .select("id, requirement_set_id, name, version, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <>
      <PageHeader
        title="Requirements"
        description="Thiết lập điều kiện hoạt động. Có thể lưu nhiều bộ và chọn bộ đang áp dụng. Mỗi lần sửa tạo phiên bản mới — kết quả cũ không bị thay đổi."
        actions={
          <Link href="/requirements/new" className={buttonVariants()}>
            <Plus /> Bộ điều kiện mới
          </Link>
        }
      />

      {sets.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Chưa có bộ điều kiện nào.{" "}
            <Link href="/requirements/new" className="text-primary hover:underline">
              Tạo bộ đầu tiên
            </Link>{" "}
            để hệ thống bắt đầu đánh giá PASS/FAIL.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sets.map((s) => {
          const c = s.config;
          return (
            <Card key={s.id} className={s.is_active ? "ring-2 ring-primary/60" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {s.name}
                      {s.is_active && <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">ĐANG ÁP DỤNG</span>}
                    </CardTitle>
                    <CardDescription>
                      v{s.version} · cập nhật {fmtDateTime(s.updated_at)} bởi {s.updated_by ?? s.created_by ?? "—"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {s.description && <p className="text-muted-foreground">{s.description}</p>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt className="text-muted-foreground">Chu kỳ đánh giá</dt>
                  <dd className="font-medium">{fmtHours(c.window_hours)}</dd>
                  <dt className="text-muted-foreground">Chế độ</dt>
                  <dd className="font-medium">{MODE_LABEL[c.mode]}</dd>
                  <dt className="text-muted-foreground">Điều kiện</dt>
                  <dd className="font-mono text-xs">{describeTree(buildRuleTree(c))}</dd>
                  <dt className="text-muted-foreground">Cảnh báo (WARNING)</dt>
                  <dd>{c.warning_pct > 0 ? `≥ ${fmtNum(c.warning_pct)}% yêu cầu` : "Tắt"}</dd>
                  <dt className="text-muted-foreground">Phạm vi</dt>
                  <dd>{c.applies_to_all ? "Toàn bộ thành viên" : `${c.included_usernames.length} thành viên chỉ định`}</dd>
                  <dt className="text-muted-foreground">Ngoại lệ</dt>
                  <dd>{c.exempt_usernames.length ? c.exempt_usernames.join(", ") : "Không"}</dd>
                </dl>
                <SetActions id={s.id} name={s.name} active={s.is_active} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(versions ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Lịch sử phiên bản</CardTitle>
            <CardDescription>Mỗi lần đánh giá lưu lại đúng phiên bản điều kiện đã dùng.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {v.name} v{v.version}
                  </span>
                  <span>{fmtDateTime(v.created_at)}</span>
                  <span>{v.created_by}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
