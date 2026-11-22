import { Sidebar } from "@/components/app/sidebar";
import { LiveSync } from "@/components/app/live-sync";
import { requireManager } from "@/lib/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const manager = await requireManager();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar manager={manager} />
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      <LiveSync />
    </div>
  );
}
