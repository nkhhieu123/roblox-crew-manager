import { LayoutDashboard, Upload, Users, ShieldAlert, History, ListChecks, Settings } from "lucide-react";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload Screenshot", icon: Upload },
  { href: "/members", label: "Members", icon: Users },
  { href: "/violations", label: "Violations", icon: ShieldAlert },
  { href: "/snapshots", label: "Snapshots History", icon: History },
  { href: "/requirements", label: "Requirements", icon: ListChecks },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
