import "server-only";
import { db } from "./supabase";
import { fetchAll } from "./fetch-all";
import { getSettings } from "./settings";
import { localParts, resetBetween } from "@/lib/engine/week";

export interface DailyPoint {
  day: string; // yyyy-mm-dd (local)
  km: number;
  donate: number;
  active: number;
}

/**
 * Crew activity per day for the last `days` days, from consecutive verified snapshots of each member.
 * Each delta is attributed to the (local) day of the later snapshot. Reset-crossing deltas count the
 * post-reset value only (a lower bound), so totals are never overstated.
 */
export async function dailyActivity(days = 30): Promise<DailyPoint[]> {
  const settings = await getSettings();
  const since = new Date(Date.now() - (days + 7) * 86_400_000).toISOString();
  const rows = await fetchAll<{
    member_id: string;
    weekly_km: number | null;
    donated: number | null;
    snapshots: { captured_at: string; donate_type: string; next_reset_at: string | null };
  }>(
    (a, b) =>
      db()
        .from("snapshot_entries")
        .select("member_id, weekly_km, donated, snapshots!inner(captured_at, donate_type, next_reset_at)")
        .eq("verified", true)
        .gte("snapshots.captured_at", since)
        .order("id")
        .range(a, b),
    "Load activity",
  );

  const byMember = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const dayKey = (iso: string) => {
    const p = localParts(new Date(iso).getTime(), settings.timezone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  };

  const agg = new Map<string, { km: number; donate: number; active: Set<string> }>();
  for (const [memberId, list] of byMember) {
    list.sort((a, b) => a.snapshots.captured_at.localeCompare(b.snapshots.captured_at));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const ta = new Date(a.snapshots.captured_at).getTime();
      const tb = new Date(b.snapshots.captured_at).getTime();
      const reset = resetBetween({ ms: ta, next_reset_at: a.snapshots.next_reset_at }, { ms: tb, next_reset_at: b.snapshots.next_reset_at }, settings);
      let km = 0;
      if (a.weekly_km !== null && b.weekly_km !== null) {
        const va = Number(a.weekly_km);
        const vb = Number(b.weekly_km);
        km = reset || vb < va ? vb : vb - va;
      }
      let don = 0;
      if (a.donated !== null && b.donated !== null && a.snapshots.donate_type === b.snapshots.donate_type) {
        const va = Number(a.donated);
        const vb = Number(b.donated);
        if (b.snapshots.donate_type === "weekly" && (reset || vb < va)) don = vb;
        else don = Math.max(0, vb - va);
      }
      const k = dayKey(b.snapshots.captured_at);
      const cur = agg.get(k) ?? { km: 0, donate: 0, active: new Set<string>() };
      cur.km += km;
      cur.donate += don;
      if (km > 0 || don > 0) cur.active.add(memberId);
      agg.set(k, cur);
    }
  }

  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86_400_000).toISOString());
    const v = agg.get(k);
    out.push({ day: k, km: Math.round(v?.km ?? 0), donate: Math.round(v?.donate ?? 0), active: v?.active.size ?? 0 });
  }
  return out;
}
