"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/auth-token";
import { env } from "@/lib/server/env";
import { audit } from "@/lib/server/audit";

function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const managers = env.managers;

  if (managers.length === 0) {
    return { error: "Chưa cấu hình tài khoản quản lý (MANAGER_1_NAME / MANAGER_1_PASSWORD)." };
  }

  let matched: string | null = null;
  for (const m of managers) {
    // evaluate every candidate to keep timing uniform
    const ok = safeEqual(m.name.toLowerCase(), name.toLowerCase()) && safeEqual(m.password, password);
    if (ok) matched = m.name;
  }

  if (!matched) {
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return { error: "Sai tên quản lý hoặc mật khẩu." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(matched), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  await audit(matched, "login", null, null);
  redirect("/");
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
