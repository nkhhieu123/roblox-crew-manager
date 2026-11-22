import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getManager } from "@/lib/server/session";
import { runOcr } from "@/lib/server/ocr";
import { getSettings } from "@/lib/server/settings";
import { db } from "@/lib/server/supabase";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg"]);
const MAX_BYTES = 4 * 1024 * 1024;

/** POST one screenshot (multipart field "image"). Returns recognised rows — nothing is saved to the DB yet. */
export async function POST(req: Request) {
  const manager = await getManager();
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Chỉ hỗ trợ PNG, JPG, JPEG" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Ảnh quá lớn (tối đa 4MB sau nén)" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());

  let imagePath: string | null = null;
  try {
    const settings = await getSettings();
    if (settings.store_images) {
      const ext = file.type === "image/png" ? "png" : "jpg";
      const d = new Date();
      const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
      const { error } = await db().storage.from(env.storageBucket).upload(path, bytes, { contentType: file.type });
      if (error) console.error("image upload failed", error.message);
      else imagePath = path;
    }
  } catch (e) {
    console.error("image storage error", e);
  }

  try {
    const result = await runOcr(bytes, file.type === "image/jpg" ? "image/jpeg" : file.type);
    return NextResponse.json({ ...result, image_path: imagePath });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("OCR failed", message);
    return NextResponse.json(
      { error: `OCR thất bại: ${message}. Kiểm tra AI_GATEWAY_API_KEY / OCR_MODEL.`, image_path: imagePath },
      { status: 502 },
    );
  }
}
