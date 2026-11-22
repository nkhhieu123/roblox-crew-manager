import "server-only";
import { db } from "./supabase";

export async function audit(
  actor: string,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  const { error } = await db()
    .from("audit_logs")
    .insert({ actor, action, entity_type: entityType, entity_id: entityId, details });
  if (error) console.error("audit log failed", error.message);
}
