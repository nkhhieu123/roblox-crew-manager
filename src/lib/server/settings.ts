import "server-only";
import { db } from "./supabase";
import { DEFAULT_SETTINGS, type GeneralSettings } from "@/lib/engine/types";

export async function getSettings(): Promise<GeneralSettings> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", "general").maybeSingle();
  if (error) throw new Error(`Load settings: ${error.message}`);
  return { ...DEFAULT_SETTINGS, ...((data?.value as Partial<GeneralSettings>) ?? {}) };
}

export async function saveSettings(value: GeneralSettings, actor: string) {
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: "general", value, updated_at: new Date().toISOString(), updated_by: actor });
  if (error) throw new Error(`Save settings: ${error.message}`);
}
