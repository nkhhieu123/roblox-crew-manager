"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/server/session";
import { db } from "@/lib/server/supabase";
import { audit } from "@/lib/server/audit";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  resolved: z.boolean(),
  note: z.string().max(1000).nullable(),
});

export async function resolveViolations(input: z.infer<typeof schema>) {
  const manager = await requireManager();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Dữ liệu không hợp lệ" };
  const { ids, resolved, note } = parsed.data;
  const { data, error } = await db()
    .from("evaluation_results")
    .update(
      resolved
        ? { resolved: true, resolved_at: new Date().toISOString(), resolved_by: manager, resolution_note: note?.trim() || null }
        : { resolved: false, resolved_at: null, resolved_by: null, resolution_note: note?.trim() || null },
    )
    .in("id", ids)
    .select("username");
  if (error) return { ok: false as const, error: error.message };
  await audit(manager, resolved ? "violation.resolve" : "violation.reopen", "evaluation_result", ids.length === 1 ? ids[0] : null, {
    count: ids.length,
    usernames: (data ?? []).map((d) => d.username),
    note,
  });
  revalidatePath("/", "layout");
  return { ok: true as const, count: ids.length };
}
