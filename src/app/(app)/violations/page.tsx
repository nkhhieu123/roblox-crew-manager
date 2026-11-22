import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/app/native-select";
import { parseViolationFilters, queryViolations } from "@/lib/server/violations";
import { getLatestEvaluation } from "@/lib/server/evaluation";
import { fmtDateTime } from "@/lib/format";
import { ViolationsTable } from "./violations-table";

export const metadata = { title: "Violations · Crew Manager" };

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filters = parseViolationFilters(sp);
  const [{ rows }, latest] = await Promise.all([queryViolations(filters), getLatestEvaluation()]);
  const qs = new URLSearchParams(
    Object.entries({
      scope: filters.scope,
      from: filters.from ?? "",
      to: filters.to ?? "",
      min: String(filters.minConsecutive || ""),
      resolved: filters.resolved,
      warning: filters.includeWarning ? "1" : "",
      q: filters.q,
    }).filter(([, v]) => v),
  ).toString();

  return (
    <>
      <PageHeader
        title="Violations"
        description={
          latest
            ? `Thành viên không đạt yêu cầu. Lần đánh giá mới nhất: ${fmtDateTime(latest.to_captured_at)} · ${latest.requirement_name}`
            : "Chưa có lần đánh giá nào."
        }
      />

      <Card className="mb-4">
        <CardContent>
          <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-7" method="get">
            <div className="space-y-1.5">
              <Label htmlFor="scope">Phạm vi</Label>
              <NativeSelect id="scope" name="scope" defaultValue={filters.scope} className="w-full">
                <option value="latest">Lần đánh giá mới nhất</option>
                <option value="all">Toàn bộ lịch sử</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Từ ngày</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Đến ngày</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min">Vi phạm liên tiếp ≥</Label>
              <Input id="min" name="min" type="number" min={0} defaultValue={filters.minConsecutive || ""} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resolved">Xử lý</Label>
              <NativeSelect id="resolved" name="resolved" defaultValue={filters.resolved} className="w-full">
                <option value="unresolved">Chưa xử lý</option>
                <option value="resolved">Đã xử lý</option>
                <option value="all">Tất cả</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q">Username</Label>
              <Input id="q" name="q" defaultValue={filters.q} placeholder="Tìm…" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="warning" value="1" defaultChecked={filters.includeWarning} className="accent-[var(--primary)]" />
                Gồm cả WARNING
              </label>
              <Button type="submit" size="sm">
                Lọc
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ViolationsTable rows={rows} exportQuery={qs} scope={filters.scope} />
    </>
  );
}
