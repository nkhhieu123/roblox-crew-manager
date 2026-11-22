"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCheck, ClipboardCopy, FileSpreadsheet, FileText, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtGain, fmtHours, fmtNum } from "@/lib/format";
import type { Status } from "@/lib/engine/types";
import { resolveViolations } from "./actions";

interface Row {
  id: string;
  username: string;
  status: Status;
  km_gain: number | null;
  km_gain_exact: boolean | null;
  km_required: number | null;
  donate_gain: number | null;
  donate_gain_exact: boolean | null;
  donate_required: number | null;
  hours: number | null;
  from_captured_at: string | null;
  to_captured_at: string | null;
  reason_summary: string | null;
  reasons: string[];
  consecutive_fails: number;
  created_at: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  evaluations: { requirement_name: string; config: { window_hours: number; period?: string } };
}

export function ViolationsTable({ rows, exportQuery, scope }: { rows: Row[]; exportQuery: string; scope: "latest" | "all" }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ ids: string[]; resolved: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const usernames = useMemo(() => Array.from(new Set(rows.map((r) => r.username))), [rows]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copy() {
    const list = selected.size ? Array.from(new Set(rows.filter((r) => selected.has(r.id)).map((r) => r.username))) : usernames;
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      toast.success(`Đã sao chép ${list.length} username`);
    } catch {
      toast.error("Trình duyệt chặn sao chép");
    }
  }

  function openDialog(ids: string[], resolved: boolean, current?: string | null) {
    setNote(current ?? "");
    setDialog({ ids, resolved });
  }

  function submit() {
    if (!dialog) return;
    start(async () => {
      const r = await resolveViolations({ ids: dialog.ids, resolved: dialog.resolved, note: note.trim() || null });
      if (!r.ok) return void toast.error(r.error);
      toast.success(dialog.resolved ? `Đã đánh dấu xử lý ${r.count} vi phạm` : `Đã mở lại ${r.count} vi phạm`);
      setDialog(null);
      setSelected(new Set());
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {rows.length} vi phạm · {usernames.length} thành viên{scope === "all" && " (toàn bộ lịch sử)"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copy} disabled={!rows.length}>
            <ClipboardCopy /> Sao chép Username{selected.size ? ` (${selected.size})` : ""}
          </Button>
          <a href={`/api/export/violations?format=xlsx&${exportQuery}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), !rows.length && "pointer-events-none opacity-50")}>
            <FileSpreadsheet /> Excel
          </a>
          <a href={`/api/export/violations?format=csv&${exportQuery}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), !rows.length && "pointer-events-none opacity-50")}>
            <FileText /> CSV
          </a>
          <Button size="sm" disabled={!selected.size} onClick={() => openDialog(Array.from(selected), true)}>
            <CheckCheck /> Đánh dấu đã xử lý ({selected.size})
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Chọn tất cả"
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Username</th>
                <th className="px-3 py-2.5 text-right font-medium">KM đạt / yêu cầu</th>
                <th className="px-3 py-2.5 text-right font-medium">Donate đạt / yêu cầu</th>
                <th className="px-3 py-2.5 text-left font-medium">Khoảng đánh giá</th>
                <th className="px-3 py-2.5 text-left font-medium">Lý do</th>
                <th className="px-3 py-2.5 text-left font-medium">Phát hiện</th>
                <th className="px-3 py-2.5 text-right font-medium">Liên tiếp</th>
                <th className="px-3 py-2.5 text-left font-medium">Xử lý</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cn("border-t align-top", selected.has(r.id) && "bg-primary/5", r.resolved && "opacity-60")}>
                  <td className="px-3 py-2.5">
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Chọn ${r.username}`} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/members/${encodeURIComponent(r.username)}`} className="font-mono text-xs font-medium text-primary hover:underline">
                      {r.username}
                    </Link>
                    <div className="mt-1">
                      <StatusBadge status={r.status} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    <span className={r.km_required !== null && (r.km_gain ?? 0) < r.km_required ? "text-destructive" : ""}>
                      {fmtGain(r.km_gain, r.km_gain_exact)}
                    </span>
                    <span className="text-muted-foreground"> / {fmtNum(r.km_required)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    <span className={r.donate_required !== null && (r.donate_gain ?? 0) < r.donate_required ? "text-destructive" : ""}>
                      {fmtGain(r.donate_gain, r.donate_gain_exact)}
                    </span>
                    <span className="text-muted-foreground"> / {fmtNum(r.donate_required)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div>{fmtHours(r.hours)} <span className="text-muted-foreground">({r.evaluations.config.period === "daily" ? "theo ngày" : `chu kỳ ${r.evaluations.config.window_hours}h`})</span></div>
                    <div className="text-muted-foreground">
                      {fmtDateTime(r.from_captured_at)} → {fmtDateTime(r.to_captured_at)}
                    </div>
                  </td>
                  <td className="max-w-72 px-3 py-2.5 text-xs">
                    <div className="font-medium">{r.reason_summary}</div>
                    {r.reasons.map((x, i) => (
                      <div key={i} className="text-muted-foreground">
                        • {x}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={cn("tabular font-semibold", r.consecutive_fails >= 3 ? "text-destructive" : r.consecutive_fails === 2 ? "text-warning" : "")}>
                      {r.consecutive_fails}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.resolved ? (
                      <div className="space-y-1">
                        <div className="text-success">✓ {r.resolved_by} · {fmtDateTime(r.resolved_at)}</div>
                        {r.resolution_note && <div className="text-muted-foreground">{r.resolution_note}</div>}
                        <Button variant="ghost" size="xs" onClick={() => openDialog([r.id], false, r.resolution_note)}>
                          <RotateCcw /> Mở lại
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="xs" onClick={() => openDialog([r.id], true, r.resolution_note)}>
                        Xử lý…
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    Không có vi phạm nào khớp bộ lọc. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.resolved ? `Đánh dấu đã xử lý (${dialog.ids.length})` : "Mở lại vi phạm"}</DialogTitle>
            <DialogDescription>Ghi chú cách xử lý (VD: đã nhắc nhở qua Discord, đã kick khỏi Crew…). Cả hai quản lý đều thấy.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú xử lý" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              Hủy
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Đang lưu…" : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
