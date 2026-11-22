"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownUp, NotebookPen, ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";
import { StatusBadge } from "@/components/app/status-badge";
import { cn } from "@/lib/utils";
import { fmtGain, fmtNum, timeAgo } from "@/lib/format";
import type { Status } from "@/lib/engine/types";

export interface MemberListRow {
  id: string;
  username: string;
  display_name: string | null;
  level: number | null;
  role: string | null;
  exempt: boolean;
  has_notes: boolean;
  last_seen_text: string | null;
  last_snapshot_at: string | null;
  status: Status | null;
  km_gain: number | null;
  km_exact: boolean | null;
  donate_gain: number | null;
  donate_exact: boolean | null;
  reason: string | null;
  no_new_data: boolean;
  consecutive: number;
  violations: number;
  /** latest values read from screenshots: KM this week and total Donated */
  current_km: number | null;
  current_donated: number | null;
}

type SortKey = "username" | "km" | "donate" | "violations" | "last" | "level" | "cur_km" | "cur_donated";
const FILTERS = ["ALL", "PASS", "FAIL", "WARNING", "PENDING", "EXEMPT", "NO_DATA"] as const;

function Th({
  k,
  children,
  right,
  active,
  onSort,
}: {
  k: SortKey;
  children: React.ReactNode;
  right?: boolean;
  active: boolean;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className={cn("px-4 py-2.5 font-medium", right ? "text-right" : "text-left")}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}
        <ArrowDownUp className="size-3" />
      </button>
    </th>
  );
}

export function MembersTable({ rows }: { rows: MemberListRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [sort, setSort] = useState<SortKey>("km");
  const [dir, setDir] = useState<1 | -1>(-1);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, NO_DATA: 0 };
    for (const r of rows) {
      if (r.status) c[r.status] = (c[r.status] ?? 0) + 1;
      if (r.no_new_data || !r.status) c.NO_DATA++;
    }
    return c;
  }, [rows]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (k && !r.username.toLowerCase().includes(k) && !r.display_name?.toLowerCase().includes(k)) return false;
      if (filter === "ALL") return true;
      if (filter === "NO_DATA") return r.no_new_data || !r.status;
      return r.status === filter;
    });
    const val = (r: MemberListRow): number | string => {
      switch (sort) {
        case "username":
          return r.username.toLowerCase();
        case "km":
          return r.km_gain ?? -Infinity;
        case "donate":
          return r.donate_gain ?? -Infinity;
        case "violations":
          return r.violations;
        case "cur_km":
          return r.current_km ?? -Infinity;
        case "cur_donated":
          return r.current_donated ?? -Infinity;
        case "level":
          return r.level ?? -Infinity;
        case "last":
          return r.last_snapshot_at ? new Date(r.last_snapshot_at).getTime() : 0;
      }
    };
    return filtered.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, q, filter, sort, dir]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(k);
      setDir(k === "username" ? 1 : -1);
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Tìm theo Username / tên…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "ALL" ? "Tất cả" : f === "NO_DATA" ? "Chưa có dữ liệu mới" : f} ({counts[f] ?? 0})
            </button>
          ))}
        </div>
        <NativeSelect value={`${sort}:${dir}`} onChange={(e) => {
          const [k, d] = e.target.value.split(":");
          setSort(k as SortKey);
          setDir(Number(d) as 1 | -1);
        }} className="ml-auto">
          <option value="cur_km:-1">KM tuần này cao nhất</option>
          <option value="cur_donated:-1">Đã donate nhiều nhất</option>
          <option value="km:-1">KM tăng nhiều nhất</option>
          <option value="km:1">KM tăng ít nhất</option>
          <option value="donate:-1">Donate tăng nhiều nhất</option>
          <option value="donate:1">Donate tăng ít nhất</option>
          <option value="violations:-1">Vi phạm nhiều nhất</option>
          <option value="last:-1">Xuất hiện gần nhất</option>
          <option value="username:1">Username A→Z</option>
        </NativeSelect>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th k="username" active={sort === "username"} onSort={toggleSort}>Thành viên</Th>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <Th k="level" right active={sort === "level"} onSort={toggleSort}>Level</Th>
                <Th k="cur_km" right active={sort === "cur_km"} onSort={toggleSort}>KM tuần này</Th>
                <Th k="cur_donated" right active={sort === "cur_donated"} onSort={toggleSort}>Đã donate</Th>
                <Th k="km" right active={sort === "km"} onSort={toggleSort}>KM tăng</Th>
                <Th k="donate" right active={sort === "donate"} onSort={toggleSort}>Donate tăng</Th>
                <th className="px-4 py-2.5 text-left font-medium">Trạng thái</th>
                <Th k="violations" right active={sort === "violations"} onSort={toggleSort}>Vi phạm</Th>
                <Th k="last" active={sort === "last"} onSort={toggleSort}>Hoạt động gần nhất</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <Link href={`/members/${encodeURIComponent(r.username)}`} className="group block">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-primary group-hover:underline">
                        {r.username}
                        {r.exempt && <ShieldOff className="size-3.5 text-info" aria-label="Miễn điều kiện" />}
                        {r.has_notes && <NotebookPen className="size-3.5 text-muted-foreground" aria-label="Có ghi chú" />}
                      </div>
                      {r.display_name && <div className="text-xs text-muted-foreground">{r.display_name}</div>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.role ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{fmtNum(r.level)}</td>
                  <td className="px-4 py-2.5 text-right tabular font-medium">{fmtNum(r.current_km)}</td>
                  <td className="px-4 py-2.5 text-right tabular font-medium">{fmtNum(r.current_donated)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{r.status ? fmtGain(r.km_gain, r.km_exact) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{r.status ? fmtGain(r.donate_gain, r.donate_exact) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <StatusBadge status={r.status} className="w-fit" />
                      {r.reason && r.status !== "PASS" && <span className="text-[11px] text-muted-foreground">{r.reason}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {r.violations > 0 ? (
                      <span className="text-destructive">
                        {r.violations}
                        {r.consecutive > 1 && <span className="text-[11px]"> ({r.consecutive} liên tiếp)</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <div>{r.last_seen_text ?? "—"}</div>
                    <div className="text-muted-foreground">Snapshot: {timeAgo(r.last_snapshot_at)}</div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                    Không có thành viên phù hợp.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
