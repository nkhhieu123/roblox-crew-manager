"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { activateRequirementSet, deleteRequirementSet } from "./actions";
import { reevaluate } from "../snapshots/actions";

export function SetActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <Link href={`/requirements/${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Pencil /> Sửa
      </Link>
      {active ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reevaluate();
              if (r.ok) toast.success("Đã đánh giá lại snapshot mới nhất", { description: r.message });
              else toast.error(r.error);
            })
          }
        >
          <RefreshCw className={pending ? "animate-spin" : ""} /> Đánh giá lại ngay
        </Button>
      ) : (
        <>
          <ConfirmButton
            variant="default"
            title={`Áp dụng "${name}"?`}
            description="Bộ điều kiện này sẽ được dùng cho các lần đánh giá tiếp theo, và snapshot mới nhất sẽ được đánh giá lại ngay. Kết quả cũ vẫn giữ nguyên."
            confirmLabel="Áp dụng"
            onConfirm={async () => {
              const r = await activateRequirementSet(id, true);
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
            }}
          >
            <CheckCircle2 /> Áp dụng
          </ConfirmButton>
          <ConfirmButton
            title={`Xóa "${name}"?`}
            description="Bộ điều kiện sẽ bị xóa. Các lần đánh giá trước đó vẫn giữ bản sao điều kiện đã dùng."
            confirmLabel="Xóa"
            onConfirm={async () => {
              const r = await deleteRequirementSet(id);
              if (r.ok) toast.success("Đã xóa");
              else toast.error(r.error);
            }}
          >
            <Trash2 /> Xóa
          </ConfirmButton>
        </>
      )}
    </div>
  );
}
