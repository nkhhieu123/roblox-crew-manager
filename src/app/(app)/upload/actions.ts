"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/server/session";
import { db } from "@/lib/server/supabase";
import { audit } from "@/lib/server/audit";
import { runEvaluation } from "@/lib/server/evaluation";
import { resolveViolationsOfLeftMembers } from "@/lib/server/left";
import { cleanUsername, usernameKey } from "@/lib/engine/parse";

const num = z.number().finite().nonnegative().nullable();

const entrySchema = z.object({
  username: z.string().trim().min(1, "Username trống").max(40),
  display_name: z.string().trim().max(80).nullable(),
  level: z.number().int().nonnegative().nullable(),
  role: z.string().trim().max(60).nullable(),
  weekly_km: num,
  donated: num,
  last_seen_text: z.string().trim().max(60).nullable(),
  needs_review: z.boolean(),
  verified: z.boolean(),
  review_notes: z.string().max(500).nullable(),
  raw: z.unknown().optional(),
});

const payloadSchema = z.object({
  captured_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Thời điểm không hợp lệ"),
  donate_type: z.enum(["cumulative", "weekly"]),
  image_paths: z.array(z.string()).max(30),
  ocr_model: z.string().nullable(),
  ocr_raw: z.unknown().optional(),
  notes: z.string().max(1000).nullable(),
  /** "Members 30 / 30" read in-game, if visible */
  crew_total: z.number().int().nonnegative().nullable(),
  /** members confirmed as no longer in the crew (complete list, absent from this snapshot) */
  mark_left: z.array(z.string().trim().min(1).max(40)).max(500),
  reset_countdown_text: z.string().max(100).nullable(),
  next_reset_at: z
    .string()
    .nullable()
    .refine((s) => s === null || !Number.isNaN(Date.parse(s)), "Mốc reset không hợp lệ"),
  entries: z.array(entrySchema).min(1, "Không có thành viên nào để lưu").max(2000),
});

export type SaveSnapshotInput = z.infer<typeof payloadSchema>;

export async function saveSnapshot(input: SaveSnapshotInput): Promise<
  { ok: true; snapshotId: string; evaluation: string } | { ok: false; error: string }
> {
  const manager = await requireManager();
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const p = parsed.data;

  const captured = new Date(p.captured_at);
  if (captured.getTime() > Date.now() + 10 * 60_000) {
    return { ok: false, error: "Thời điểm snapshot không được ở tương lai." };
  }

  if (p.next_reset_at) {
    const diff = new Date(p.next_reset_at).getTime() - captured.getTime();
    if (diff <= 0 || diff > 7 * 86_400_000 + 3_600_000) {
      return { ok: false, error: "Mốc reset phải nằm trong vòng 7 ngày sau thời điểm snapshot." };
    }
  }

  // de-duplicate by username (case-insensitive)
  const seen = new Set<string>();
  for (const e of p.entries) {
    e.username = cleanUsername(e.username);
    const k = usernameKey(e.username);
    if (seen.has(k)) return { ok: false, error: `Username bị trùng: ${e.username}` };
    seen.add(k);
  }

  const { data, error } = await db().rpc("save_snapshot", {
    payload: {
      ...p,
      captured_at: captured.toISOString(),
      next_reset_at: p.next_reset_at ? new Date(p.next_reset_at).toISOString() : null,
      uploaded_by: manager,
    },
  });
  if (error) return { ok: false, error: `Lưu snapshot thất bại: ${error.message}` };
  const snapshotId = data as string;

  const unverified = p.entries.filter((e) => !e.verified).length;
  await audit(manager, "snapshot.create", "snapshot", snapshotId, {
    captured_at: captured.toISOString(),
    members: p.entries.length,
    unverified,
    images: p.image_paths.length,
    donate_type: p.donate_type,
    next_reset_at: p.next_reset_at,
    reset_countdown_text: p.reset_countdown_text,
    crew_total: p.crew_total,
    marked_left: p.mark_left,
  });
  if (p.mark_left.length) await resolveViolationsOfLeftMembers({ usernames: p.mark_left }, manager);

  let evaluation = "";
  try {
    const r = await runEvaluation({ snapshotId, actor: manager, trigger: "auto" });
    evaluation = r.ok
      ? `Đã đánh giá: ${r.summary.PASS} PASS · ${r.summary.FAIL} FAIL · ${r.summary.WARNING} WARNING · ${r.summary.PENDING} PENDING`
      : r.reason;
  } catch (e) {
    evaluation = `Đánh giá tự động lỗi: ${e instanceof Error ? e.message : String(e)}`;
  }

  revalidatePath("/", "layout");
  return { ok: true, snapshotId, evaluation };
}
