"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/server/session";
import { db } from "@/lib/server/supabase";
import { audit } from "@/lib/server/audit";
import { runEvaluation } from "@/lib/server/evaluation";
import { requirementConfigSchema } from "@/lib/engine/schema";
import type { RequirementConfig } from "@/lib/engine/types";

const inputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Tên bộ điều kiện trống").max(80),
  description: z.string().trim().max(500).nullable(),
  config: requirementConfigSchema,
});

export async function saveRequirementSet(input: {
  id: string | null;
  name: string;
  description: string | null;
  config: RequirementConfig;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const manager = await requireManager();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { id, name, description, config } = parsed.data;
  const now = new Date().toISOString();

  if (id) {
    const { data: before } = await db().from("requirement_sets").select("*").eq("id", id).single();
    if (!before) return { ok: false, error: "Không tìm thấy bộ điều kiện" };
    const version = before.version + 1;
    const { error } = await db()
      .from("requirement_sets")
      .update({ name, description, config, version, updated_by: manager, updated_at: now })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await db().from("requirement_versions").insert({ requirement_set_id: id, name, version, config, created_by: manager });
    await audit(manager, "requirement.update", "requirement_set", id, {
      name,
      version,
      before: before.config,
      after: config,
    });
    revalidatePath("/", "layout");
    return { ok: true, id };
  }

  const { data: created, error } = await db()
    .from("requirement_sets")
    .insert({ name, description, config, version: 1, created_by: manager, updated_by: manager })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Tạo thất bại" };
  await db().from("requirement_versions").insert({ requirement_set_id: created.id, name, version: 1, config, created_by: manager });

  // first set ever → make it active automatically
  const { count } = await db().from("requirement_sets").select("id", { count: "exact", head: true }).eq("is_active", true);
  if (!count) await db().from("requirement_sets").update({ is_active: true }).eq("id", created.id);

  await audit(manager, "requirement.create", "requirement_set", created.id, { name, config });
  revalidatePath("/", "layout");
  return { ok: true, id: created.id };
}

export async function activateRequirementSet(id: string, evaluateNow: boolean) {
  const manager = await requireManager();
  const { data: set } = await db().from("requirement_sets").select("id, name, version").eq("id", id).single();
  if (!set) return { ok: false as const, error: "Không tìm thấy bộ điều kiện" };
  const { error: e1 } = await db().from("requirement_sets").update({ is_active: false }).eq("is_active", true);
  if (e1) return { ok: false as const, error: e1.message };
  const { error: e2 } = await db().from("requirement_sets").update({ is_active: true }).eq("id", id);
  if (e2) return { ok: false as const, error: e2.message };
  await audit(manager, "requirement.activate", "requirement_set", id, { name: set.name, version: set.version });

  let message = `Đang áp dụng: ${set.name}`;
  if (evaluateNow) {
    const r = await runEvaluation({ actor: manager, trigger: "manual" });
    message += r.ok ? ` · Đã đánh giá lại snapshot mới nhất (${r.summary.FAIL} FAIL)` : ` · ${r.reason}`;
  }
  revalidatePath("/", "layout");
  return { ok: true as const, message };
}

export async function deleteRequirementSet(id: string) {
  const manager = await requireManager();
  const { data: set } = await db().from("requirement_sets").select("id, name, is_active").eq("id", id).single();
  if (!set) return { ok: false as const, error: "Không tìm thấy bộ điều kiện" };
  if (set.is_active) return { ok: false as const, error: "Không thể xóa bộ điều kiện đang áp dụng. Hãy kích hoạt bộ khác trước." };
  const { error } = await db().from("requirement_sets").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, "requirement.delete", "requirement_set", id, { name: set.name });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
