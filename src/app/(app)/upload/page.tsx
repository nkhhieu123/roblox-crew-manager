import { PageHeader } from "@/components/app/page-header";
import { UploadClient } from "./upload-client";
import { db } from "@/lib/server/supabase";
import { fetchAll } from "@/lib/server/fetch-all";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Upload Screenshot · Crew Manager" };

export default async function UploadPage() {
  const [members, settings, lastReset] = await Promise.all([
    fetchAll<{ username: string; display_name: string | null }>(
      (a, b) => db().from("members").select("username, display_name").order("username").range(a, b),
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
  ]);
  return (
    <>
      <PageHeader
        title="Upload Screenshot"
        description="Tải ảnh danh sách Members → AI đọc dữ liệu → kiểm tra/sửa → lưu Snapshot. Hệ thống tự so sánh với các snapshot trước."
      />
      <UploadClient knownMembers={members} defaultDonateType={settings.default_donate_type} storeImages={settings.store_images}
        lastNextResetAt={(lastReset.data?.next_reset_at as string | undefined) ?? null}
      />
    </>
  );
}
