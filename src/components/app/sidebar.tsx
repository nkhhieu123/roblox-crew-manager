"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, Radar } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { logout } from "@/app/login/actions";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-sidebar-primary")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Radar className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Crew Manager</div>
        <div className="text-xs text-muted-foreground">Activity Tracker</div>
      </div>
    </div>
  );
}

function Footer({ manager }: { manager: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 pt-3">
      <div className="min-w-0 text-xs">
        <div className="text-muted-foreground">Đăng nhập với</div>
        <div className="truncate font-medium">{manager}</div>
      </div>
      <form action={logout}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Đăng xuất" title="Đăng xuất">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}

export function Sidebar({ manager }: { manager: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar py-4 lg:flex">
        <Brand />
        <div className="flex-1 px-2">
          <NavLinks />
        </div>
        <Footer manager={manager} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Mở menu">
          <Menu className="size-5" />
        </Button>
        <Brand />
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 py-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-full flex-col gap-6">
            <Brand />
            <div className="flex-1 px-2">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <Footer manager={manager} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
