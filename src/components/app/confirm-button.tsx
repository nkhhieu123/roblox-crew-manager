"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** A button that asks for confirmation before running a (destructive) action. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Xác nhận",
  onConfirm,
  variant = "destructive",
  size = "sm",
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await onConfirm();
                  setOpen(false);
                })
              }
            >
              {pending ? "Đang xử lý…" : confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
