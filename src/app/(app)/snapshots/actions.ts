"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/server/session";
import { db } from "@/lib/server/supabase";
import { audit } from "@/lib/server/audit";
import { env } from "@/lib/server/env";
import { runEvaluation } from "@/lib/server/evaluation";

const num = z.number().finite().nonnegative().nullable();
const patchSchema = z.object({
  display_name: z.string().trim().max(80).nullable(),
  level: z.number().int().nonnegative().nullable(),
  role: z.string().trim().max(60).nullable(),
  weekly_km: num,
  donated: num,
  last_seen_text: z.string().trim().max(60).nullable(),
  verified: z.boolean(),
});

export async function updateEntry(entryId: string, patch: z.infer<typeof patchSchema>) {
  const manager = await requireManager();
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const { data: before, error: e1 } = await db()
    .from("snapshot_entries")
    .select("*, snapshots(captured_at)")
    .eq("id", entryId)
    .single();
  if (e1 || !before) return { ok: false as const, error: "Không tìm thấy dòng dữ liệu" };

  const p = parsed.data;
  const { error } = await db()
    .from("snapshot_entries")
    .update({ ...p, needs_review: p.verified ? false : before.needs_review, updated_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) return { ok: false as const, error: error.message };

  // refresh member profile when this verified entry belongs to the member's newest snapshot
  if (p.verified) {
    const capturedAt = (before.snapshots as { captured_at: string } | null)?.captured_at;
    const { data: member } = await db().from("members").select("last_snapshot_at").eq("id", before.member_id).single();
    if (capturedAt && member && new Date(member.last_snapshot_at).getTime() <= new Date(capturedAt).getTime()) {
      await db()
        .from("members")
        .update({
          display_name: p.display_name ?? undefined,
          level: p.level ?? undefined,
          role: p.role ?? undefined,
          last_seen_text: p.last_seen_text ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", before.member_id);
    }
  }

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(p) as (keyof typeof p)[]) {
    const from = before[k] === null || before[k] === undefined ? null : before[k];
    const to = p[k];
    if (String(from) !== String(to)) changed[k] = { from, to };
  }
  await audit(manager, "entry.update", "snapshot_entry", entryId, {
    username: before.username,
    snapshot_id: before.snapshot_id,
    changed,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteSnapshot(snapshotId: string) {
  const manager = await requireManager();
  const { data: snap, error: e1 } = await db()
    .from("snapshots")
    .select("id, captured_at, image_paths, member_count")
    .eq("id", snapshotId)
    .single();
  if (e1 || !snap) return { ok: false as const, error: "Không tìm thấy snapshot" };

  const { error } = await db().from("snapshots").delete().eq("id", snapshotId);
  if (error) return { ok: false as const, error: error.message };
  if (snap.image_paths?.length) {
    await db().storage.from(env.storageBucket).remove(snap.image_paths);
  }
  await audit(manager, "snapshot.delete", "snapshot", snapshotId, {
    captured_at: snap.captured_at,
    member_count: snap.member_count,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function reevaluate(snapshotId?: string) {
  const manager = await requireManager();
  try {
    const r = await runEvaluation({ snapshotId, actor: manager, trigger: "manual" });
    revalidatePath("/", "layout");
    return r.ok
      ? { ok: true as const, message: `${r.summary.PASS} PASS · ${r.summary.FAIL} FAIL · ${r.summary.WARNING} WARNING · ${r.summary.PENDING} PENDING · ${r.summary.EXEMPT} EXEMPT` }
      : { ok: false as const, error: r.reason };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
