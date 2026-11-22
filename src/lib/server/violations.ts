import "server-only";
import { db } from "./supabase";
import { fetchAll } from "./fetch-all";
import { getLatestEvaluation, type ResultRow } from "./evaluation";

export interface ViolationFilters {
  scope: "latest" | "all";
  from: string | null; // yyyy-mm-dd
  to: string | null;
  minConsecutive: number;
  resolved: "unresolved" | "resolved" | "all";
  includeWarning: boolean;
  q: string;
}

export type ViolationRow = ResultRow & {
  evaluations: { requirement_name: string; config: { window_hours: number }; created_at: string };
};

export function parseViolationFilters(sp: Record<string, string | string[] | undefined>): ViolationFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const date = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  return {
    scope: one("scope") === "all" ? "all" : "latest",
    from: date(one("from")),
    to: date(one("to")),
    minConsecutive: Math.max(0, Number(one("min")) || 0),
    resolved: (["resolved", "all"].includes(one("resolved")) ? one("resolved") : "unresolved") as ViolationFilters["resolved"],
    includeWarning: one("warning") === "1",
    q: one("q").trim().slice(0, 40),
  };
}

export async function queryViolations(f: ViolationFilters): Promise<{ rows: ViolationRow[]; latestId: string | null }> {
  // "latest" = the most recent FINISHED period (a day still running cannot have violations yet)
  const latest = f.scope === "latest" ? await getLatestEvaluation({ finalOnly: true }) : null;
  if (f.scope === "latest" && !latest) return { rows: [], latestId: null };

  const statuses = f.includeWarning ? ["FAIL", "WARNING"] : ["FAIL"];
  const rows = await fetchAll<ViolationRow>((a, b) => {
    let q = db()
      .from("evaluation_results")
      .select("*, evaluations!inner(requirement_name, config, created_at, superseded)")
      .in("status", statuses)
      .eq("evaluations.superseded", false)
      .gte("consecutive_fails", f.minConsecutive);
    if (latest) q = q.eq("evaluation_id", latest.id);
    // dates are interpreted in Vietnam time (UTC+7)
    if (f.from) q = q.gte("to_captured_at", `${f.from}T00:00:00+07:00`);
    if (f.to) q = q.lte("to_captured_at", `${f.to}T23:59:59+07:00`);
    if (f.resolved !== "all") q = q.eq("resolved", f.resolved === "resolved");
    if (f.q) q = q.ilike("username", `%${f.q.replace(/[%_]/g, "")}%`);
    return q.order("to_captured_at", { ascending: false }).order("consecutive_fails", { ascending: false }).range(a, b);
  }, "Load violations");
  return { rows, latestId: latest?.id ?? null };
}
