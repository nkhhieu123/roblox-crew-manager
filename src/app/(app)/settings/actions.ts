"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/server/session";
import { audit } from "@/lib/server/audit";
import { getSettings, saveSettings } from "@/lib/server/settings";

const schema = z.object({
  store_images: z.boolean(),
  default_donate_type: z.enum(["cumulative", "weekly"]),
  week_reset_weekday: z.number().int().min(0).max(6),
  week_reset_hour: z.number().int().min(0).max(23),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Múi giờ không hợp lệ"),
  baseline_tolerance_pct: z.number().min(0).max(50),
});

export async function updateSettings(input: z.infer<typeof schema>) {
  const manager = await requireManager();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const before = await getSettings();
  await saveSettings(parsed.data, manager);
  await audit(manager, "settings.update", "settings", "general", { before, after: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
