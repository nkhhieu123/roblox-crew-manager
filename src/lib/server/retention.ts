import "server-only";
import { db, must } from "./supabase";
import { env } from "./env";
import { getSettings } from "./settings";
import { audit } from "./audit";

/** Delete original screenshots older than the retention period. Snapshot numbers are kept. */
export async function purgeOldImages(): Promise<{ snapshots: number; files: number }> {
  const settings = await getSettings();
  const days = settings.image_retention_days ?? 14;
  if (!days || days <= 0) return { snapshots: 0, files: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = must(
    await db().from("snapshots").select("id, image_paths").lt("captured_at", cutoff).neq("image_paths", "{}").limit(200),
    "Load old snapshots",
  ) as { id: string; image_paths: string[] }[];
  let files = 0;
  for (const s of old) {
    if (!s.image_paths?.length) continue;
    const { error } = await db().storage.from(env.storageBucket).remove(s.image_paths);
    if (error) {
      console.error("purge failed", s.id, error.message);
      continue;
    }
    files += s.image_paths.length;
    await db().from("snapshots").update({ image_paths: [] }).eq("id", s.id);
  }
  if (files) await audit("system (dọn ảnh)", "images.purge", null, null, { snapshots: old.length, files, older_than_days: days });
  return { snapshots: old.length, files };
}
