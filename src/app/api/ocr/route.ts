import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getManager } from "@/lib/server/session";
import { runOcr, type OcrImage } from "@/lib/server/ocr";
import { getSettings } from "@/lib/server/settings";
import { db } from "@/lib/server/supabase";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg"]);
// Vercel limits a request body to 4.5MB in total (all images together)
const MAX_TOTAL_BYTES = 4.3 * 1024 * 1024;
const MAX_IMAGES = 12;

/**
 * POST all screenshots of one upload (multipart fields "image", repeated).
 * They are read in ONE model call. Returns recognised rows — nothing is saved to the DB yet.
 */
export async function POST(req: Request) {
  const manager = await getManager();
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("image") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
  if (files.length > MAX_IMAGES) return NextResponse.json({ error: `Tối đa ${MAX_IMAGES} ảnh mỗi lần` }, { status: 400 });
  if (files.some((f) => !ALLOWED.has(f.type))) return NextResponse.json({ error: "Chỉ hỗ trợ PNG, JPG, JPEG" }, { status: 400 });
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "Tổng dung lượng ảnh quá lớn sau nén — hãy upload ít ảnh hơn mỗi lần" }, { status: 413 });
  }

  const images: (OcrImage & { ext: string })[] = await Promise.all(
    files.map(async (f) => ({
      data: new Uint8Array(await f.arrayBuffer()),
      mediaType: f.type === "image/png" ? "image/png" : "image/jpeg",
      ext: f.type === "image/png" ? "png" : "jpg",
    })),
  );

  // store originals (optional) — paths are returned so the snapshot can reference them
  const imagePaths: (string | null)[] = images.map(() => null);
  try {
    const settings = await getSettings();
    if (settings.store_images) {
      const d = new Date();
      await Promise.all(
        images.map(async (img, i) => {
          const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${img.ext}`;
          const { error } = await db().storage.from(env.storageBucket).upload(path, img.data, { contentType: img.mediaType });
          if (error) console.error("image upload failed", error.message);
          else imagePaths[i] = path;
        }),
      );
    }
  } catch (e) {
    console.error("image storage error", e);
  }

  try {
    const result = await runOcr(images.map(({ data, mediaType }) => ({ data, mediaType })));
    return NextResponse.json({ ...result, image_paths: imagePaths });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("OCR failed", message);
    // don't leave orphan images behind when nothing could be read
    const stored = imagePaths.filter((x): x is string => !!x);
    if (stored.length) await db().storage.from(env.storageBucket).remove(stored);
    return NextResponse.json({ error: `OCR thất bại: ${message}` }, { status: 502 });
  }
}
