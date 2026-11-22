import "server-only";
import { db, must } from "./supabase";
import { DEFAULT_REQUIREMENT, type RequirementConfig } from "@/lib/engine/types";

export interface RequirementSetRow {
  id: string;
  name: string;
  description: string | null;
  config: RequirementConfig;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export function normalizeConfig(c: Partial<RequirementConfig> | null | undefined): RequirementConfig {
  return { ...DEFAULT_REQUIREMENT, ...(c ?? {}) };
}

export async function getActiveRequirement(): Promise<RequirementSetRow | null> {
  const row = must(
    await db().from("requirement_sets").select("*").eq("is_active", true).maybeSingle(),
    "Load active requirement",
  ) as RequirementSetRow | null;
  return row ? { ...row, config: normalizeConfig(row.config) } : null;
}

/** Returns the immutable version row for the set's current version, creating it if missing. */
export async function ensureVersion(set: RequirementSetRow, actor: string): Promise<string> {
  const existing = must(
    await db()
      .from("requirement_versions")
      .select("id")
      .eq("requirement_set_id", set.id)
      .eq("version", set.version)
      .maybeSingle(),
    "Load requirement version",
  ) as { id: string } | null;
  if (existing) return existing.id;
  const created = must(
    await db()
      .from("requirement_versions")
      .insert({
        requirement_set_id: set.id,
        name: set.name,
        version: set.version,
        config: set.config,
        created_by: actor,
      })
      .select("id")
      .single(),
    "Create requirement version",
  ) as { id: string };
  return created.id;
}
