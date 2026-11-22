import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-token";
import { env } from "./env";

/** Returns the logged-in manager name, or null. Also re-checks the name is still a configured manager. */
export async function getManager(): Promise<string | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return env.managers.some((m) => m.name === session.name) ? session.name : null;
}

/** For pages and server actions: redirects to /login when not authenticated. */
export async function requireManager(): Promise<string> {
  const name = await getManager();
  if (!name) redirect("/login");
  return name;
}

/** For route handlers: returns name or throws a 401-able error. */
export class UnauthorizedError extends Error {}
export async function requireManagerApi(): Promise<string> {
  const name = await getManager();
  if (!name) throw new UnauthorizedError("Unauthorized");
  return name;
}
