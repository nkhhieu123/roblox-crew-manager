"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { deleteSnapshot, reevaluate } from "../actions";

export function SnapshotActions({ snapshotId, capturedAt, memberCount }: { snapshotId: string; capturedAt: string; memberCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reevaluate(snapshotId);
            if (r.ok) toast.success("Đã đánh giá lại", { description: r.message });
            else toast.error(r.error);
          })
        }
      >
        <RefreshCw className={pending ? "animate-spin" : ""} /> Đánh giá lại
      </Button>
      <ConfirmButton
        title="Xóa snapshot này?"
        description={
          <>
            Snapshot <b>{capturedAt}</b> với {memberCount} thành viên và ảnh gốc sẽ bị xóa vĩnh viễn. Các kết quả đánh giá cũ vẫn được giữ trong lịch sử.
            Hành động này không thể hoàn tác.
          </>
        }
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={async () => {
          const r = await deleteSnapshot(snapshotId);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("Đã xóa snapshot");
          router.push("/snapshots");
        }}
      >
        <Trash2 /> Xóa
      </ConfirmButton>
    </>
  );
}
