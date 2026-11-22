"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps both managers in sync: polls the latest audit-log id and refreshes
 * server components whenever the other manager changed something.
 */
export function LiveSync({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  const last = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/sync", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: number };
        if (last.current !== null && version !== last.current && !stopped) router.refresh();
        last.current = version;
      } catch {
        // offline: ignore
      }
    }
    tick();
    const id = setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, intervalMs]);

  return null;
}
