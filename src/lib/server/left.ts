import "server-only";
import { db } from "./supabase";
import { usernameKey } from "@/lib/engine/parse";

/** Members who left / were kicked: their open violations count as handled. */
export async function resolveViolationsOfLeftMembers(by: { ids?: string[]; usernames?: string[] }, actor: string) {
  let ids = by.ids ?? [];
  if (by.usernames?.length) {
    const { data } = await db()
      .from("members")
      .select("id")
      .in("username_key", by.usernames.map(usernameKey));
    ids = [...ids, ...(data ?? []).map((m) => m.id as string)];
  }
  if (!ids.length) return 0;
  const { data, error } = await db()
    .from("evaluation_results")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: actor, resolution_note: "Đã rời crew (kick)" })
    .in("member_id", ids)
    .in("status", ["FAIL", "WARNING"])
    .eq("resolved", false)
    .select("id");
  if (error) console.error("auto-resolve failed", error.message);
  return data?.length ?? 0;
}
