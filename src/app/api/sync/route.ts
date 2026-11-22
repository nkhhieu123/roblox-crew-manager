import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { getManager } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Returns the latest audit-log id; clients refresh when it changes. */
export async function GET() {
  if (!(await getManager())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await db()
    .from("audit_logs")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ version: data?.id ?? 0 });
}
