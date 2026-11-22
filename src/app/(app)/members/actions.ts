"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/server/session";
import { db } from "@/lib/server/supabase";
import { audit } from "@/lib/server/audit";
import { usernameKey } from "@/lib/engine/parse";

export async function setExempt(memberId: string, exempt: boolean, reason: string | null) {
  const manager = await requireManager();
  const { data: m } = await db().from("members").select("username").eq("id", memberId).single();
  if (!m) return { ok: false as const, error: "Không tìm thấy thành viên" };
  const { error } = await db()
    .from("members")
    .update({ exempt, exempt_reason: exempt ? reason?.slice(0, 300) || null : null, updated_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, exempt ? "member.exempt" : "member.unexempt", "member", memberId, { username: m.username, reason });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setLeft(memberId: string, left: boolean) {
  const manager = await requireManager();
  const { data: m } = await db().from("members").select("username").eq("id", memberId).single();
  if (!m) return { ok: false as const, error: "Không tìm thấy thành viên" };
  const { error } = await db()
    .from("members")
    .update({ left_at: left ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, left ? "member.left" : "member.rejoined", "member", memberId, { username: m.username });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function saveNotes(memberId: string, notes: string) {
  const manager = await requireManager();
  const { data: m } = await db().from("members").select("username").eq("id", memberId).single();
  if (!m) return { ok: false as const, error: "Không tìm thấy thành viên" };
  const { error } = await db()
    .from("members")
    .update({ notes: notes.slice(0, 5000) || null, updated_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, "member.notes", "member", memberId, { username: m.username });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Merge a member created by an OCR typo into the correct member:
 * moves all snapshot entries, then deletes the wrong profile.
 */
export async function mergeMember(sourceId: string, targetUsername: string) {
  const manager = await requireManager();
  const { data: source } = await db().from("members").select("*").eq("id", sourceId).single();
  if (!source) return { ok: false as const, error: "Không tìm thấy thành viên nguồn" };
  const { data: target } = await db()
    .from("members")
    .select("*")
    .eq("username_key", usernameKey(targetUsername))
    .maybeSingle();
  if (!target) return { ok: false as const, error: `Không tìm thấy thành viên "${targetUsername}"` };
  if (target.id === source.id) return { ok: false as const, error: "Không thể gộp vào chính nó" };

  const [{ data: sEntries }, { data: tEntries }] = await Promise.all([
    db().from("snapshot_entries").select("id, snapshot_id").eq("member_id", source.id),
    db().from("snapshot_entries").select("snapshot_id").eq("member_id", target.id),
  ]);
  const targetSnaps = new Set((tEntries ?? []).map((e) => e.snapshot_id));
  const conflicts = (sEntries ?? []).filter((e) => targetSnaps.has(e.snapshot_id));
  if (conflicts.length) {
    return {
      ok: false as const,
      error: `Cả hai cùng xuất hiện trong ${conflicts.length} snapshot — đây có thể là 2 người khác nhau. Hãy kiểm tra lại.`,
    };
  }

  const ids = (sEntries ?? []).map((e) => e.id);
  if (ids.length) {
    const { error } = await db()
      .from("snapshot_entries")
      .update({ member_id: target.id, username: target.username })
      .in("id", ids);
    if (error) return { ok: false as const, error: error.message };
  }
  await db().from("evaluation_results").update({ member_id: target.id }).eq("member_id", source.id);

  const first = [source.first_seen_at, target.first_seen_at].filter(Boolean).sort()[0] ?? null;
  const last = [source.last_snapshot_at, target.last_snapshot_at].filter(Boolean).sort().reverse()[0] ?? null;
  await db().from("members").update({ first_seen_at: first, last_snapshot_at: last }).eq("id", target.id);
  await db().from("members").delete().eq("id", source.id);

  await audit(manager, "member.merge", "member", target.id, {
    from: source.username,
    into: target.username,
    entries_moved: ids.length,
  });
  revalidatePath("/", "layout");
  return { ok: true as const, username: target.username as string };
}

export async function deleteMember(memberId: string) {
  const manager = await requireManager();
  const { data: m } = await db().from("members").select("username").eq("id", memberId).single();
  if (!m) return { ok: false as const, error: "Không tìm thấy thành viên" };
  const { error } = await db().from("members").delete().eq("id", memberId);
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, "member.delete", "member", memberId, { username: m.username });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
