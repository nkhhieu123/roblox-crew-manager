"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { parseInteger, parseNumber } from "@/lib/engine/parse";
import { updateEntry } from "../actions";

export interface EntryRow {
  id: string;
  member_id: string;
  username: string;
  display_name: string | null;
  level: number | null;
  role: string | null;
  weekly_km: number | null;
  donated: number | null;
  last_seen_text: string | null;
  needs_review: boolean;
  verified: boolean;
  review_notes: string | null;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function EntriesTable({ entries }: { entries: EntryRow[] }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? entries.filter((e) => e.username.toLowerCase().includes(k) || e.display_name?.toLowerCase().includes(k)) : entries;
  }, [entries, q]);

  return (
    <>
      <div className="px-4 pb-3">
        <Input placeholder="Tìm username…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Username</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-right font-medium">Level</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-right font-medium">Weekly KM</th>
              <th className="px-4 py-2 text-right font-medium">Donated</th>
              <th className="px-4 py-2 text-left font-medium">Last Seen</th>
              <th className="px-4 py-2 text-left font-medium">Trạng thái</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className={cn("border-t", !e.verified && "bg-warning/5")}>
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/members/${encodeURIComponent(e.username)}`} className="text-primary hover:underline">
                    {e.username}
                  </Link>
                </td>
                <td className="px-4 py-2">{e.display_name ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular">{fmtNum(e.level)}</td>
                <td className="px-4 py-2">{e.role ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular">{e.weekly_km === null ? <span className="text-muted-foreground">Chưa rõ</span> : fmtNum(e.weekly_km)}</td>
                <td className="px-4 py-2 text-right tabular">{e.donated === null ? <span className="text-muted-foreground">Chưa rõ</span> : fmtNum(e.donated)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{e.last_seen_text ?? "—"}</td>
                <td className="px-4 py-2 text-xs">
                  {e.verified ? <span className="text-success">Đã xác thực</span> : <span className="text-warning" title={e.review_notes ?? ""}>Cần kiểm tra</span>}
                </td>
                <td className="px-2 py-2">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(e)} aria-label="Sửa">
                    <Pencil />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditDialog entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditDialog({ entry, onClose }: { entry: EntryRow; onClose: () => void }) {
  const [form, setForm] = useState({
    display_name: s(entry.display_name),
    level: s(entry.level),
    role: s(entry.role),
    weekly_km: s(entry.weekly_km),
    donated: s(entry.donated),
    last_seen_text: s(entry.last_seen_text),
    verified: entry.verified,
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  function submit() {
    const km = form.weekly_km.trim() ? parseNumber(form.weekly_km) : null;
    const don = form.donated.trim() ? parseNumber(form.donated) : null;
    const lvl = form.level.trim() ? parseInteger(form.level) : null;
    if (form.weekly_km.trim() && km === null) return void toast.error("KM không hợp lệ");
    if (form.donated.trim() && don === null) return void toast.error("Donate không hợp lệ");
    if (form.level.trim() && lvl === null) return void toast.error("Level không hợp lệ");
    start(async () => {
      const r = await updateEntry(entry.id, {
        display_name: form.display_name.trim() || null,
        level: lvl,
        role: form.role.trim() || null,
        weekly_km: km,
        donated: don,
        last_seen_text: form.last_seen_text.trim() || null,
        verified: form.verified,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Đã lưu. Bấm “Đánh giá lại” để cập nhật kết quả.");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{entry.username}</DialogTitle>
          <DialogDescription>Mọi thay đổi được ghi vào nhật ký thao tác. Username không sửa được ở đây (là định danh).</DialogDescription>
        </DialogHeader>
        {entry.review_notes && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{entry.review_notes}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Display Name</Label>
            <Input value={form.display_name} onChange={set("display_name")} />
          </div>
          <div className="space-y-1.5">
            <Label>Weekly KM</Label>
            <Input value={form.weekly_km} onChange={set("weekly_km")} placeholder="Chưa rõ" />
          </div>
          <div className="space-y-1.5">
            <Label>Donated</Label>
            <Input value={form.donated} onChange={set("donated")} placeholder="Chưa rõ" />
          </div>
          <div className="space-y-1.5">
            <Label>Level</Label>
            <Input value={form.level} onChange={set("level")} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Input value={form.role} onChange={set("role")} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Last Seen</Label>
            <Input value={form.last_seen_text} onChange={set("last_seen_text")} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox checked={form.verified} onCheckedChange={(v) => setForm({ ...form, verified: v === true })} />
            Đã xác thực — dùng dữ liệu này để so sánh
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Hủy
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
