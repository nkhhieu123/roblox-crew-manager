"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, Plus, ScanText, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { cn } from "@/lib/utils";
import { levenshtein, parseInteger, parseNumber, usernameKey } from "@/lib/engine/parse";
import { toLocalInput } from "@/lib/format";
import type { DonateType } from "@/lib/engine/types";
import { saveSnapshot, type SaveSnapshotInput } from "./actions";

interface ImageItem {
  id: string;
  file: File;
  url: string;
  status: "idle" | "processing" | "done" | "error";
  error?: string;
  imagePath?: string | null;
  rowCount?: number;
}

interface OcrRowDto {
  username: string;
  display_name: string | null;
  level: number | null;
  role: string | null;
  weekly_km: number | null;
  donated: number | null;
  last_seen_text: string | null;
  needs_review: boolean;
  review_notes: string | null;
  raw: Record<string, unknown>;
}

interface OcrResponse {
  model: string;
  is_member_list: boolean;
  km_label: string | null;
  donate_label: string | null;
  columns_visible: string[];
  rows: OcrRowDto[];
  image_path: string | null;
  error?: string;
}

interface DraftRow {
  id: string;
  username: string;
  display_name: string;
  level: string;
  role: string;
  weekly_km: string;
  donated: string;
  last_seen_text: string;
  needs_review: boolean;
  verified: boolean;
  review_notes: string;
  imageIndex: number | null;
  raw: Record<string, unknown> | null;
}

const MAX_UPLOAD_BYTES = 3.8 * 1024 * 1024;
const uid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Downscale/compress large screenshots so each request stays under Vercel's 4.5MB body limit. */
async function prepareImage(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES && file.type !== "image/jpg") return file;
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  for (let quality = 0.92; ; quality -= 0.08) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Không nén được ảnh"))), "image/jpeg", quality),
    );
    if (blob.size <= MAX_UPLOAD_BYTES || quality < 0.5) {
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    if (quality < 0.7) scale *= 0.85;
  }
}

function sameValues(a: DraftRow, b: OcrRowDto) {
  return (
    str(a.weekly_km) === str(b.weekly_km) &&
    str(a.donated) === str(b.donated) &&
    str(a.level) === str(b.level) &&
    (a.role || "") === (b.role || "")
  );
}

export function UploadClient({
  knownMembers,
  defaultDonateType,
  storeImages,
}: {
  knownMembers: { username: string; display_name: string | null }[];
  defaultDonateType: DonateType;
  storeImages: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [capturedAt, setCapturedAt] = useState(() => toLocalInput(new Date()));
  const [donateType, setDonateType] = useState<DonateType>(defaultDonateType);
  const [labels, setLabels] = useState<{ km: string | null; donate: string | null; columns: string[] }>({ km: null, donate: null, columns: [] });
  const [model, setModel] = useState<string | null>(null);
  const [rawOutputs, setRawOutputs] = useState<unknown[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, startSave] = useTransition();

  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of knownMembers) map.set(usernameKey(m.username), m.username);
    return map;
  }, [knownMembers]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /^image\/(png|jpe?g)$/.test(f.type));
    if (list.length === 0) {
      toast.error("Chỉ hỗ trợ ảnh PNG, JPG, JPEG");
      return;
    }
    setImages((prev) => [
      ...prev,
      ...list.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file), status: "idle" as const })),
    ]);
  }, []);

  function removeImage(id: string) {
    setImages((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((i) => i.id !== id);
    });
  }

  function mergeRows(incoming: OcrRowDto[], imageIndex: number) {
    setRows((prev) => {
      const next = [...prev];
      for (const r of incoming) {
        const key = r.username ? usernameKey(r.username) : "";
        const idx = key ? next.findIndex((x) => usernameKey(x.username) === key) : -1;
        if (idx >= 0) {
          // same member appears in two overlapping screenshots
          const existing = next[idx];
          if (!sameValues(existing, r)) {
            next[idx] = {
              ...existing,
              needs_review: true,
              verified: false,
              review_notes: [
                existing.review_notes,
                `Ảnh ${imageIndex + 1} đọc khác: KM ${str(r.weekly_km) || "?"}, Donate ${str(r.donated) || "?"}`,
              ]
                .filter(Boolean)
                .join("; "),
            };
          }
          continue;
        }
        next.push({
          id: uid(),
          username: r.username,
          display_name: r.display_name ?? "",
          level: str(r.level),
          role: r.role ?? "",
          weekly_km: str(r.weekly_km),
          donated: str(r.donated),
          last_seen_text: r.last_seen_text ?? "",
          needs_review: r.needs_review,
          verified: !r.needs_review,
          review_notes: r.review_notes ?? "",
          imageIndex,
          raw: r.raw,
        });
      }
      return next;
    });
  }

  async function scan() {
    const pending = images.filter((i) => i.status !== "done");
    if (pending.length === 0) {
      toast.info("Tất cả ảnh đã được quét");
      return;
    }
    setScanning(true);
    for (const item of pending) {
      const index = images.findIndex((i) => i.id === item.id);
      setImages((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "processing", error: undefined } : i)));
      try {
        const prepared = await prepareImage(item.file);
        const fd = new FormData();
        fd.append("image", prepared);
        const res = await fetch("/api/ocr", { method: "POST", body: fd });
        const data = (await res.json()) as OcrResponse;
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!data.is_member_list) toast.warning(`Ảnh ${index + 1}: có vẻ không phải danh sách Members — hãy kiểm tra kỹ.`);
        mergeRows(data.rows, index);
        setModel(data.model);
        setRawOutputs((prev) => [...prev, { image: index + 1, km_label: data.km_label, donate_label: data.donate_label, columns: data.columns_visible, rows: data.rows.map((r) => r.raw) }]);
        setLabels((prev) => ({
          km: prev.km ?? data.km_label,
          donate: prev.donate ?? data.donate_label,
          columns: Array.from(new Set([...prev.columns, ...data.columns_visible])),
        }));
        if (data.donate_label && /week|tuần|weekly/i.test(data.donate_label)) setDonateType("weekly");
        setImages((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "done", imagePath: data.image_path, rowCount: data.rows.length } : i)),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setImages((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "error", error: msg } : i)));
        toast.error(`Ảnh ${index + 1}: ${msg}`);
      }
    }
    setScanning(false);
  }

  function update(id: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addManualRow() {
    setRows((prev) => [
      ...prev,
      {
        id: uid(), username: "", display_name: "", level: "", role: "", weekly_km: "", donated: "",
        last_seen_text: "", needs_review: true, verified: false, review_notes: "Thêm thủ công", imageIndex: null, raw: null,
      },
    ]);
  }

  const duplicateKeys = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      const k = usernameKey(r.username);
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);

  function suggestion(username: string): string | null {
    const k = usernameKey(username);
    if (!k || known.has(k)) return null;
    let best: string | null = null;
    let bestD = 3;
    for (const [key, name] of known) {
      if (Math.abs(key.length - k.length) > 2) continue;
      const d = levenshtein(k, key);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  const stats = useMemo(() => {
    const unverified = rows.filter((r) => !r.verified).length;
    const newMembers = rows.filter((r) => r.username && !known.has(usernameKey(r.username))).length;
    return { total: rows.length, unverified, newMembers };
  }, [rows, known]);

  function save() {
    // validate numbers
    const entries: SaveSnapshotInput["entries"] = [];
    for (const [i, r] of rows.entries()) {
      if (!r.username.trim()) {
        toast.error(`Dòng ${i + 1}: thiếu Username`);
        return;
      }
      const km = r.weekly_km.trim() ? parseNumber(r.weekly_km) : null;
      const don = r.donated.trim() ? parseNumber(r.donated) : null;
      const lvl = r.level.trim() ? parseInteger(r.level) : null;
      if (r.weekly_km.trim() && km === null) return void toast.error(`Dòng ${i + 1}: KM "${r.weekly_km}" không hợp lệ`);
      if (r.donated.trim() && don === null) return void toast.error(`Dòng ${i + 1}: Donate "${r.donated}" không hợp lệ`);
      if (r.level.trim() && lvl === null) return void toast.error(`Dòng ${i + 1}: Level "${r.level}" không hợp lệ`);
      entries.push({
        username: r.username.trim(),
        display_name: r.display_name.trim() || null,
        level: lvl,
        role: r.role.trim() || null,
        weekly_km: km,
        donated: don,
        last_seen_text: r.last_seen_text.trim() || null,
        needs_review: r.needs_review,
        verified: r.verified,
        review_notes: r.review_notes.trim() || null,
        raw: r.raw ?? undefined,
      });
    }
    if (duplicateKeys.size) return void toast.error("Có Username bị trùng — hãy gộp hoặc xóa dòng trùng.");
    const captured = new Date(capturedAt);
    if (Number.isNaN(captured.getTime())) return void toast.error("Thời điểm snapshot không hợp lệ");

    startSave(async () => {
      const res = await saveSnapshot({
        captured_at: captured.toISOString(),
        donate_type: donateType,
        image_paths: images.map((i) => i.imagePath).filter((p): p is string => !!p),
        ocr_model: model,
        ocr_raw: { labels, outputs: rawOutputs },
        notes: notes.trim() || null,
        entries,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Đã lưu snapshot", { description: res.evaluation });
      router.push(`/snapshots/${res.snapshotId}`);
    });
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — images */}
      <Card>
        <CardHeader>
          <CardTitle>1. Chọn ảnh chụp màn hình</CardTitle>
          <CardDescription>
            PNG / JPG / JPEG, có thể chọn nhiều ảnh (ví dụ cuộn danh sách thành nhiều ảnh).{" "}
            {storeImages ? "Ảnh gốc sẽ được lưu trữ." : "Lưu trữ ảnh gốc đang tắt (Settings)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            <ImagePlus className="size-8 text-muted-foreground" />
            <div className="text-sm font-medium">Kéo thả ảnh vào đây hoặc bấm để chọn</div>
            <div className="text-xs text-muted-foreground">Ảnh lớn sẽ được tự động nén trước khi gửi</div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {images.map((img, i) => (
                <div key={img.id} className="group relative overflow-hidden rounded-lg border bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Ảnh ${i + 1}`} className="aspect-[4/3] w-full object-cover object-top" />
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs">
                    <span className="truncate">Ảnh {i + 1}</span>
                    {img.status === "processing" && <Loader2 className="size-3.5 animate-spin text-primary" />}
                    {img.status === "done" && (
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" /> {img.rowCount}
                      </span>
                    )}
                    {img.status === "error" && (
                      <span className="flex items-center gap-1 text-destructive" title={img.error}>
                        <AlertTriangle className="size-3.5" /> Lỗi
                      </span>
                    )}
                  </div>
                  {img.status !== "processing" && (
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute right-1 top-1 rounded-md bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Bỏ ảnh"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={scan} disabled={scanning || images.length === 0}>
              {scanning ? <Loader2 className="animate-spin" /> : <ScanText />}
              {scanning ? "Đang quét OCR…" : "Quét OCR"}
            </Button>
            {scanning && <span className="text-sm text-muted-foreground">AI đang đọc từng ảnh, vui lòng chờ…</span>}
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — review */}
      {(rows.length > 0 || images.some((i) => i.status === "done")) && (
        <Card>
          <CardHeader>
            <CardTitle>2. Kiểm tra kết quả nhận diện</CardTitle>
            <CardDescription>
              Sửa trực tiếp nếu AI đọc sai. Dòng <span className="text-warning">màu vàng</span> là dữ liệu chưa chắc chắn —
              chỉ những dòng đã tick <b>Xác thực</b> mới được dùng để so sánh. Ô trống = không đọc được (không tự đoán).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-muted px-2 py-1">{stats.total} thành viên</span>
              <span className={cn("rounded-md px-2 py-1", stats.unverified ? "bg-warning/15 text-warning" : "bg-success/15 text-success")}>
                {stats.unverified} chưa xác thực
              </span>
              <span className="rounded-md bg-info/15 px-2 py-1 text-info">{stats.newMembers} thành viên mới</span>
              {labels.columns.length > 0 && (
                <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">Cột thấy được: {labels.columns.join(", ")}</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Xác thực</th>
                    <th className="px-2 py-2 text-left font-medium">Username *</th>
                    <th className="px-2 py-2 text-left font-medium">Display Name</th>
                    <th className="px-2 py-2 text-left font-medium">Level</th>
                    <th className="px-2 py-2 text-left font-medium">Role</th>
                    <th className="px-2 py-2 text-left font-medium">Weekly KM</th>
                    <th className="px-2 py-2 text-left font-medium">Donated</th>
                    <th className="px-2 py-2 text-left font-medium">Last Seen</th>
                    <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const k = usernameKey(r.username);
                    const isNew = !!k && !known.has(k);
                    const sug = isNew ? suggestion(r.username) : null;
                    const dup = duplicateKeys.has(k);
                    return (
                      <tr key={r.id} className={cn("border-t align-top", !r.verified && "bg-warning/5", dup && "bg-destructive/10")}>
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={r.verified}
                            onCheckedChange={(v) => update(r.id, { verified: v === true })}
                            aria-label="Xác thực"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.username}
                            onChange={(e) => update(r.id, { username: e.target.value })}
                            className={cn("h-7 w-40 font-mono text-xs", (!r.username || dup) && "border-destructive")}
                          />
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                            {isNew && <span className="text-info">Mới</span>}
                            {dup && <span className="text-destructive">Trùng</span>}
                            {sug && (
                              <button
                                type="button"
                                className="text-warning underline underline-offset-2"
                                onClick={() => update(r.id, { username: sug })}
                              >
                                Có phải {sug}?
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={r.display_name} onChange={(e) => update(r.id, { display_name: e.target.value })} className="h-7 w-36 text-xs" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={r.level} onChange={(e) => update(r.id, { level: e.target.value })} className="h-7 w-16 text-xs tabular" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={r.role} onChange={(e) => update(r.id, { role: e.target.value })} className="h-7 w-28 text-xs" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.weekly_km}
                            placeholder="?"
                            title={r.raw ? `OCR: ${str(r.raw.weekly_km_text) || "không thấy"}` : undefined}
                            onChange={(e) => update(r.id, { weekly_km: e.target.value })}
                            className="h-7 w-24 text-xs tabular"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.donated}
                            placeholder="?"
                            title={r.raw ? `OCR: ${str(r.raw.donated_text) || "không thấy"}` : undefined}
                            onChange={(e) => update(r.id, { donated: e.target.value })}
                            className="h-7 w-24 text-xs tabular"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={r.last_seen_text} onChange={(e) => update(r.id, { last_seen_text: e.target.value })} className="h-7 w-24 text-xs" />
                        </td>
                        <td className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
                          {r.review_notes && (
                            <span className={cn(r.needs_review && "text-warning")}>{r.review_notes}</span>
                          )}
                          {r.imageIndex !== null && <div className="text-[11px]">Ảnh {r.imageIndex + 1}</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                            aria-label="Xóa dòng"
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                        Không nhận diện được thành viên nào. Thử ảnh rõ hơn hoặc thêm thủ công.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={addManualRow}>
                <Plus /> Thêm dòng
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows((prev) => prev.map((r) => ({ ...r, verified: true })))}
                disabled={!stats.unverified}
              >
                <CheckCircle2 /> Xác thực tất cả (đã kiểm tra)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — save */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Lưu Snapshot</CardTitle>
            <CardDescription>Snapshot mới không ghi đè snapshot cũ. Sau khi lưu, hệ thống tự so sánh và đánh giá theo bộ điều kiện đang áp dụng.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="captured">Thời điểm dữ liệu (snapshot time)</Label>
                <Input id="captured" type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
                <p className="text-xs text-muted-foreground">Mặc định = lúc upload. Sửa nếu ảnh được chụp từ trước. Giờ upload thực tế luôn được ghi riêng.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dtype">Loại chỉ số Donate</Label>
                <NativeSelect id="dtype" value={donateType} onChange={(e) => setDonateType(e.target.value as DonateType)} className="w-full">
                  <option value="cumulative">Tổng tích lũy (all-time) — tính phần tăng thêm</option>
                  <option value="weekly">Theo tuần — reset mỗi tuần</option>
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  Nhãn AI đọc được: <b>{labels.donate ?? "không thấy"}</b>. KM: <b>{labels.km ?? "không thấy"}</b> (luôn xử lý như Weekly, reset mỗi tuần).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Ghi chú (tùy chọn)</Label>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            {stats.unverified > 0 && (
              <p className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle className="size-4" /> {stats.unverified} dòng chưa xác thực sẽ được lưu nhưng KHÔNG dùng để so sánh / không cập nhật hồ sơ cho đến khi xác thực.
              </p>
            )}
            <Button size="lg" onClick={save} disabled={saving || scanning}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? "Đang lưu & đánh giá…" : `Lưu snapshot (${stats.total} thành viên)`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
