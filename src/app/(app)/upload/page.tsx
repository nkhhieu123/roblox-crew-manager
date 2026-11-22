import { PageHeader } from "@/components/app/page-header";
import { UploadClient, type PreviousValue } from "./upload-client";
import { db } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getSettings } from "@/lib/server/settings";
import { usernameKey } from "@/lib/engine/parse";

export const metadata = { title: "Upload Screenshot · Crew Manager" };

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default async function UploadPage() {
  const since = daysAgoIso(60);
  const [members, settings, lastReset, recent] = await Promise.all([
    fetchAll<{ username: string; display_name: string | null; left_at: string | null }>(
      (a, b) => db().from("members").select("username, display_name, left_at").order("username").range(a, b),
      "Load members",
    ),
    getSettings(),
    db()
      .from("snapshots")
      .select("next_reset_at")
      .not("next_reset_at", "is", null)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // each member's most recent verified values, to show KM / Donate gained right after scanning
    fetchAll<{
      username: string;
      weekly_km: number | null;
      donated: number | null;
      snapshots: { captured_at: string; next_reset_at: string | null; donate_type: string };
    }>(
      (a, b) =>
        db()
          .from("snapshot_entries")
          .select("username, weekly_km, donated, snapshots!inner(captured_at, next_reset_at, donate_type)")
          .eq("verified", true)
          .gte("snapshots.captured_at", since)
          .order("id")
          .range(a, b),
      "Load previous values",
    ),
  ]);

  const previous: Record<string, PreviousValue> = {};
  const activeKeys = new Set(members.filter((m) => !m.left_at).map((m) => usernameKey(m.username)));
  for (const e of recent) {
    const k = usernameKey(e.username);
    if (!activeKeys.has(k)) continue; // left the crew: not expected in new screenshots
    const cur = previous[k];
    if (cur && cur.captured_at >= e.snapshots.captured_at) continue;
    previous[k] = {
      captured_at: e.snapshots.captured_at,
      next_reset_at: e.snapshots.next_reset_at,
      donate_type: e.snapshots.donate_type === "weekly" ? "weekly" : "cumulative",
      weekly_km: e.weekly_km === null ? null : Number(e.weekly_km),
      donated: e.donated === null ? null : Number(e.donated),
    };
  }

  return (
    <>
      <PageHeader
        title="Upload Screenshot"
        description="Tải ảnh danh sách Members → AI đọc dữ liệu → kiểm tra/sửa → lưu Snapshot. Hệ thống tự so sánh với các snapshot trước."
      />
      <UploadClient
        knownMembers={members}
        defaultDonateType={settings.default_donate_type}
        storeImages={settings.store_images}
        lastNextResetAt={(lastReset.data?.next_reset_at as string | undefined) ?? null}
        previous={previous}
        resetSettings={{
          week_reset_weekday: settings.week_reset_weekday,
          week_reset_hour: settings.week_reset_hour,
          timezone: settings.timezone,
        }}
      />
    </>
  );
}
