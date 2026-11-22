import { cn } from "@/lib/utils";
import type { Status } from "@/lib/engine/types";

const STYLES: Record<Status, string> = {
  PASS: "bg-success/15 text-success ring-success/30",
  FAIL: "bg-destructive/15 text-destructive ring-destructive/30",
  WARNING: "bg-warning/15 text-warning ring-warning/30",
  PENDING: "bg-muted text-muted-foreground ring-border",
  EXEMPT: "bg-info/15 text-info ring-info/30",
};

export const STATUS_LABEL: Record<Status, string> = {
  PASS: "PASS",
  FAIL: "FAIL",
  WARNING: "WARNING",
  PENDING: "PENDING",
  EXEMPT: "EXEMPT",
};

export function StatusBadge({ status, className }: { status: Status | null | undefined; className?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">Chưa đánh giá</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide ring-1 ring-inset",
        STYLES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
