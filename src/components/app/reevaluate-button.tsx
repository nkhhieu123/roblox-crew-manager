"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reevaluate } from "@/app/(app)/snapshots/actions";

/** Re-run the evaluation for the latest snapshot (and close the previous day). */
export function ReevaluateButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await reevaluate();
          if (r.ok) toast.success("Đã đánh giá lại", { description: r.message });
          else toast.error(r.error);
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : ""} /> {pending ? "Đang đánh giá…" : "Đánh giá lại"}
    </Button>
  );
}
