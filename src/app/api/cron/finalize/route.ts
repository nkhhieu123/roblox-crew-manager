import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runEvaluation } from "@/lib/server/evaluation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly job (Vercel Cron, 00:05 Vietnam time): re-evaluates around the latest snapshot so the day that just
 * ended is closed (PASS / FAIL) even when nobody uploads a new screenshot.
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = !!secret && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const r = await runEvaluation({ actor: "system (tự chốt 0h)", trigger: "auto" });
    return NextResponse.json(r.ok ? { ok: true, summary: r.summary } : { ok: false, reason: r.reason });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
