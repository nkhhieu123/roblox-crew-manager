"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardPaste, ImagePlus, Loader2, Plus, ScanText, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { cn } from "@/lib/utils";
import { levenshtein, parseInteger, parseNumber, usernameKey } from "@/lib/engine/parse";
import { fmtDateTime, toLocalInput } from "@/lib/format";
import { parseCountdown, resetBetween, WEEK_MS } from "@/lib/engine/week";
import type { DonateType, GeneralSettings } from "@/lib/engine/types";
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
  image_index: number;
  raw: Record<string, unknown>;
}

interface OcrResponse {
  model: string;
  is_member_list: boolean;
  km_label: string | null;
  donate_label: string | null;
  reset_countdown_text: string | null;
  reset_in_seconds: number | null;
  member_total: number | null;
  columns_visible: string[];
  rows: OcrRowDto[];
  image_paths: (string | null)[];
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

/** All images of one scan are sent in one request; Vercel caps a request body at 4.5MB in total. */
const TOTAL_UPLOAD_BYTES = 4.0 * 1024 * 1024;
const uid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Downscale/compress large screenshots so each request stays under Vercel's 4.5MB body limit. */
async function prepareImage(file: File, budget: number): Promise<File> {
  if (file.size <= budget && file.type !== "image/jpg") return file;
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
    if (blob.size <= budget || quality < 0.5) {
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    if (quality < 0.7) scale *= 0.85;
  }
}

/** A member's most recent verified values (from the previous snapshot that contained them). */
export interface PreviousValue {
  captured_at: string;
  next_reset_at: string | null;
  donate_type: DonateType;
  weekly_km: number | null;
  donated: number | null;
}

type Delta = { text: string; tone: "up" | "zero" | "warn" | "muted"; title?: string };

/** Display names use fancy symbols that OCR reads inconsistently ("・ メ ・" / "・メ・"): compare without spaces. */
function nameKey(n: string | null | undefined): string {
  return (n ?? "").replace(/\s+/g, "").toLowerCase();
}

/** How many single-letter OCR slips we accept between two usernames of this length. */
function typoBudget(len: number): number {
  return len >= 8 ? 2 : len >= 5 ? 1 : 0;
}

/** Same person read twice from overlapping screenshots, with a username differing by a few characters? */
function looksLikeSamePerson(a: DraftRow, b: OcrRowDto): boolean {
  const da = nameKey(a.display_name);
  const db = nameKey(b.display_name);
  if (!da || da !== db) return false;
  if (b.weekly_km === null || b.donated === null) return false;
  if (str(a.weekly_km) !== str(b.weekly_km) || str(a.donated) !== str(b.donated)) return false;
  const ka = usernameKey(a.username);
  const kb = usernameKey(b.username ?? "");
  return !ka || !kb || levenshtein(ka, kb) <= 3;
}

export function UploadClient({
  knownMembers,
  defaultDonateType,
  storeImages,
  lastNextResetAt,
  previous,
  resetSettings,
}: {
  knownMembers: { username: string; display_name: string | null; left_at?: string | null }[];
  defaultDonateType: DonateType;
  storeImages: boolean;
  lastNextResetAt: string | null;
  previous: Record<string, PreviousValue>;
  resetSettings: Pick<GeneralSettings, "week_reset_weekday" | "week_reset_hour" | "timezone">;
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
  const [memberTotal, setMemberTotal] = useState<number | null>(null);
  // weekly reset countdown read from the screenshot ("Resets in 2d 05:12:33")
  const [countdownText, setCountdownText] = useState("");
  const countdownSecs = parseCountdown(countdownText);
  const nextReset = useMemo(() => {
    const cap = new Date(capturedAt);
    if (countdownSecs === null || Number.isNaN(cap.getTime())) return null;
    return new Date(cap.getTime() + countdownSecs * 1000);
  }, [capturedAt, countdownSecs]);
  // consistency with the reset time read on earlier screenshots (should differ by whole weeks only)
  const resetMismatchMin = useMemo(() => {
    if (!nextReset || !lastNextResetAt) return null;
    const diff = nextReset.getTime() - new Date(lastNextResetAt).getTime();
    const off = diff - Math.round(diff / WEEK_MS) * WEEK_MS;
    return Math.round(Math.abs(off) / 60000);
  }, [nextReset, lastNextResetAt]);
  const [saving, startSave] = useTransition();

  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of knownMembers) map.set(usernameKey(m.username), m.username);
    return map;
  }, [knownMembers]);

  /**
   * OCR often misreads one or two letters of the tiny "@username" (a/o, v/y, i/j…). If the username is not a
   * known member but a known member has the SAME display name and a username at most 2 edits away, it is the
   * same person: use the known username.
   * Display names are often fancy symbols that OCR reads differently each time, so also accept a single known
   * member whose username is 1–2 letters away and who is NOT otherwise in this scan (otherwise the real member
   * would look absent and be marked as "left").
   */
  const correctUsername = useCallback(
    (username: string, displayName: string | null, scanKeys: Set<string>): { username: string; why: string } | null => {
      const k = usernameKey(username);
      if (!k || known.has(k)) return null;
      const d = nameKey(displayName);
      if (d) {
        const same = knownMembers.filter((m) => nameKey(m.display_name) === d && levenshtein(usernameKey(m.username), k) <= 2);
        if (same.length === 1) return { username: same[0].username, why: "cùng tên hiển thị" };
      }
      const near = knownMembers.filter((m) => {
        const mk = usernameKey(m.username);
        return !m.left_at && !scanKeys.has(mk) && levenshtein(mk, k) <= typoBudget(Math.min(mk.length, k.length));
      });
      if (near.length === 1) return { username: near[0].username, why: "chỉ khác 1–2 ký tự, người này không có ở chỗ khác trong ảnh" };
      return null;
    },
    [known, knownMembers],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
      .filter((f) => /^image\/(png|jpe?g)$/.test(f.type))
      // pasted screenshots are all called "image.png" — give them a unique, readable name
      .map((f) => (/^image\.(png|jpe?g)$/i.test(f.name) || !f.name ? new File([f], `dan-anh-${Date.now()}-${uid()}.${f.type === "image/png" ? "png" : "jpg"}`, { type: f.type }) : f));
    if (list.length === 0) {
      toast.error("Chỉ hỗ trợ ảnh PNG, JPG, JPEG");
      return;
    }
    setImages((prev) => [
      ...prev,
      ...list.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file), status: "idle" as const })),
    ]);
  }, []);

  // paste a screenshot anywhere on the page (Ctrl+V / Cmd+V)
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return; // plain text paste into an input keeps working
      e.preventDefault();
      addFiles(files);
      toast.success(`Đã dán ${files.length} ảnh`);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  /** "Dán ảnh" button — reads an image from the clipboard (useful on phones / tablets). */
  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error("unsupported");
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t === "image/png" || t === "image/jpeg");
        if (type) {
          const blob = await item.getType(type);
          files.push(new File([blob], "image.png", { type }));
        }
      }
      if (files.length === 0) {
        toast.info("Bộ nhớ tạm chưa có ảnh. Hãy chụp màn hình / sao chép ảnh rồi bấm lại.");
        return;
      }
      addFiles(files);
      toast.success(`Đã dán ${files.length} ảnh`);
    } catch {
      toast.error("Trình duyệt không cho đọc ảnh từ bộ nhớ tạm. Hãy bấm Ctrl+V (máy tính) hoặc chọn ảnh từ thư viện.");
    }
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((i) => i.id !== id);
    });
  }

  function mergeRows(incoming: OcrRowDto[], imageIndex: number, scanUsernames: (string | null)[]) {
    setRows((prev) => {
      const next = [...prev];
      const scanKeys = new Set([...prev.map((x) => x.username), ...scanUsernames].filter(Boolean).map((u) => usernameKey(u!)));
      for (const r of incoming) {
        const key = r.username ? usernameKey(r.username) : "";
        const idx = key ? next.findIndex((x) => usernameKey(x.username) === key) : -1;
        const fuzzyIdx = idx < 0 ? next.findIndex((x) => looksLikeSamePerson(x, r)) : -1;
        if (fuzzyIdx >= 0) {
          // overlapping screenshots: same display name + identical stats, username read slightly differently
          const existing = next[fuzzyIdx];
          const a = existing.username;
          const b = r.username;
          // prefer a username that is already a known member, then the reading that was not cut off / uncertain
          const aKnown = known.has(usernameKey(a));
          const bKnown = !!b && known.has(usernameKey(b));
          const useB = !!b && (bKnown && !aKnown ? true : aKnown && !bKnown ? false : existing.needs_review && !r.needs_review);
          const chosen = useB ? b : a;
          const bothConfident = !existing.needs_review && !r.needs_review && !!a && !!b && !aKnown && !bKnown;
          next[fuzzyIdx] = {
            ...existing,
            username: chosen,
            needs_review: bothConfident,
            verified: bothConfident ? false : existing.verified || !r.needs_review,
            review_notes: [
              useB ? r.review_notes : existing.review_notes,
              a && b && usernameKey(a) !== usernameKey(b)
                ? `Trùng giữa 2 ảnh, Username đọc khác: ${a} / ${b} → đã gộp, dùng ${chosen}`
                : `Trùng giữa 2 ảnh → đã gộp`,
            ]
              .filter(Boolean)
              .join("; "),
          };
          continue;
        }
        if (idx >= 0) {
          // same member appears in two overlapping screenshots
          const existing = next[idx];
          // fill blanks from the other screenshot; only flag real conflicts (both readings have a value and differ)
          const filled: DraftRow = {
            ...existing,
            display_name: existing.display_name || (r.display_name ?? ""),
            level: existing.level || str(r.level),
            role: existing.role || (r.role ?? ""),
            weekly_km: existing.weekly_km || str(r.weekly_km),
            donated: existing.donated || str(r.donated),
            last_seen_text: existing.last_seen_text || (r.last_seen_text ?? ""),
          };
          const conflict = (x: string, y: unknown) => x !== "" && str(y) !== "" && x !== str(y);
          const hasConflict =
            conflict(existing.weekly_km, r.weekly_km) || conflict(existing.donated, r.donated) || conflict(existing.level, r.level);
          if (!hasConflict) {
            // a clean reading confirms a row that was only uncertain because it was cut off
            const confirmed = existing.needs_review && !r.needs_review && !!filled.weekly_km && !!filled.donated;
            next[idx] = confirmed
              ? { ...filled, needs_review: false, verified: true, review_notes: "Đã xác nhận bằng ảnh khác (dòng bị cắt ở 1 ảnh)" }
              : filled;
            continue;
          }
          if (hasConflict) {
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
        const fix = r.username ? correctUsername(r.username, r.display_name, scanKeys) : null;
        const corrected = fix?.username ?? null;
        if (corrected) {
          const ci = next.findIndex((x) => usernameKey(x.username) === usernameKey(corrected));
          if (ci >= 0) continue; // already present under the correct username
        }
        next.push({
          id: uid(),
          username: corrected ?? r.username,
          display_name: r.display_name ?? "",
          level: str(r.level),
          role: r.role ?? "",
          weekly_km: str(r.weekly_km),
          donated: str(r.donated),
          last_seen_text: r.last_seen_text ?? "",
          needs_review: r.needs_review,
          verified: !r.needs_review,
          review_notes: [r.review_notes, fix ? `Tự sửa Username: AI đọc "${r.username}" → dùng "${fix.username}" (${fix.why})` : null]
            .filter(Boolean)
            .join("; "),
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
    const ids = new Set(pending.map((p) => p.id));
    const indexOf = (id: string) => images.findIndex((i) => i.id === id);
    setImages((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, status: "processing", error: undefined } : i)));
    try {
      // one request for all screenshots → one AI call per upload (saves the daily free quota)
      const budget = Math.floor(TOTAL_UPLOAD_BYTES / pending.length);
      const fd = new FormData();
      for (const item of pending) fd.append("image", await prepareImage(item.file, budget));
      const res = await fetch("/api/ocr", { method: "POST", body: fd });
      const data = (await res.json()) as OcrResponse;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.is_member_list) toast.warning("Ảnh có vẻ không phải danh sách Members — hãy kiểm tra kỹ.");

      // merge image by image, in upload order, so overlapping rows are detected
      const scanUsernames = data.rows.map((r) => r.username);
      pending.forEach((item, k) => {
        mergeRows(
          data.rows.filter((r) => r.image_index === k),
          indexOf(item.id),
          scanUsernames,
        );
      });
      if (data.member_total) setMemberTotal((prev) => Math.max(prev ?? 0, data.member_total!));
      setModel(data.model);
      setRawOutputs((prev) => [...prev, { images: pending.map((p) => indexOf(p.id) + 1), km_label: data.km_label, donate_label: data.donate_label, columns: data.columns_visible, rows: data.rows.map((r) => r.raw) }]);
      setLabels((prev) => ({
        km: prev.km ?? data.km_label,
        donate: prev.donate ?? data.donate_label,
        columns: Array.from(new Set([...prev.columns, ...data.columns_visible])),
      }));
      if (data.donate_label && /week|tuần|weekly/i.test(data.donate_label)) setDonateType("weekly");
      if (data.reset_countdown_text) {
        setCountdownText((prev) => prev || data.reset_countdown_text!);
        if (data.reset_in_seconds === null) toast.warning(`Không hiểu định dạng đồng hồ reset "${data.reset_countdown_text}" — hãy nhập lại.`);
      }
      setImages((prev) =>
        prev.map((i) => {
          const k = pending.findIndex((p) => p.id === i.id);
          return k < 0
            ? i
            : { ...i, status: "done", imagePath: data.image_paths?.[k] ?? null, rowCount: data.rows.filter((r) => r.image_index === k).length };
        }),
      );
      toast.success(`Đã đọc ${pending.length} ảnh (${data.model})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImages((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, status: "error", error: msg } : i)));
      toast.error(msg, { duration: 15000 });
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

  /** KM / Donate gained since the member's previous snapshot, computed as soon as the image is scanned. */
  function deltas(r: DraftRow): { km: Delta; donate: Delta; since: string | null } {
    const prev = previous[usernameKey(r.username)];
    const none: Delta = { text: "Mới", tone: "muted", title: "Chưa có snapshot trước để so sánh" };
    if (!prev) return { km: none, donate: none, since: null };
    const capMs = new Date(capturedAt).getTime();
    const prevMs = new Date(prev.captured_at).getTime();
    const hours = (capMs - prevMs) / 3600_000;
    const since =
      hours <= 0 ? null : hours >= 48 ? `${Math.round(hours / 24)} ngày` : hours >= 1 ? `${Math.round(hours)} giờ` : `${Math.max(1, Math.round(hours * 60))} phút`;
    const reset = resetBetween(
      { ms: prevMs, next_reset_at: prev.next_reset_at },
      { ms: capMs, next_reset_at: nextReset ? nextReset.toISOString() : null },
      resetSettings,
    );
    const calc = (curText: string, before: number | null, weekly: boolean): Delta => {
      const cur = curText.trim() ? parseNumber(curText) : null;
      if (cur === null || before === null) return { text: "Chưa rõ", tone: "muted" };
      if (hours <= 0) return { text: "—", tone: "muted", title: "Thời điểm dữ liệu không sau snapshot trước" };
      if (weekly && reset) return { text: `≥ +${cur.toLocaleString("vi-VN")}`, tone: cur > 0 ? "up" : "zero", title: "Đã qua mốc reset tuần — chỉ biết mức tăng tối thiểu" };
      if (cur < before) return { text: `${(cur - before).toLocaleString("vi-VN")}`, tone: "warn", title: weekly ? "KM giảm — reset sớm hoặc đọc sai" : "Donate tích lũy giảm — có thể đọc sai" };
      const d = cur - before;
      return { text: `+${d.toLocaleString("vi-VN")}`, tone: d > 0 ? "up" : "zero", title: `Trước: ${before.toLocaleString("vi-VN")}` };
    };
    return {
      km: calc(r.weekly_km, prev.weekly_km, true),
      donate: prev.donate_type !== donateType ? { text: "Khác loại", tone: "warn", title: "Loại chỉ số Donate khác snapshot trước" } : calc(r.donated, prev.donated, donateType === "weekly"),
      since,
    };
  }

  // usernames the manager un-ticked in the "left the crew" list
  const [keepInCrew, setKeepInCrew] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const unverified = rows.filter((r) => !r.verified).length;
    const newNames = rows.filter((r) => r.username && !known.has(usernameKey(r.username))).map((r) => r.username);
    const present = new Set(rows.map((r) => usernameKey(r.username)));
    // members seen in the last snapshot (have previous values) but not in this scan
    const missing = Object.keys(previous)
      .filter((k) => !present.has(k))
      .map((k) => known.get(k) ?? k);
    return { total: rows.length, unverified, newMembers: newNames.length, newNames, missing };
  }, [rows, known, previous]);

  /** Only when the scan covers the whole crew ("Members 30 / 30" matches) can absent members be marked as left. */
  // never auto-mark someone as left when a "new" name in this scan is only a letter or two away from theirs:
  // that is almost certainly the same person with a misread username
  const leftCandidates = useMemo(() => {
    if (memberTotal === null || memberTotal !== stats.total || stats.unverified !== 0) return [];
    const newKeys = stats.newNames.map(usernameKey);
    return stats.missing.filter((u) => {
      const mk = usernameKey(u);
      return !newKeys.some((nk) => levenshtein(nk, mk) <= Math.max(2, typoBudget(Math.min(nk.length, mk.length))));
    });
  }, [memberTotal, stats]);

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
    if (countdownText.trim() && countdownSecs === null) return void toast.error("Đồng hồ reset không đúng định dạng (VD: 2d 05:12:33)");

    startSave(async () => {
      const res = await saveSnapshot({
        captured_at: captured.toISOString(),
        donate_type: donateType,
        image_paths: images.map((i) => i.imagePath).filter((p): p is string => !!p),
        ocr_model: model,
        ocr_raw: { labels, outputs: rawOutputs },
        notes: notes.trim() || null,
        reset_countdown_text: countdownText.trim() || null,
        next_reset_at: nextReset ? nextReset.toISOString() : null,
        crew_total: memberTotal,
        mark_left: leftCandidates.filter((u) => !keepInCrew.has(u)),
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
            <div className="text-sm font-medium">Dán ảnh (Ctrl+V), kéo thả, hoặc bấm để chọn</div>
            <div className="text-xs text-muted-foreground">Chụp màn hình xong bấm Ctrl+V ở trang này là xong · Ảnh lớn sẽ được tự động nén</div>
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
            <Button variant="outline" onClick={pasteFromClipboard} disabled={scanning}>
              <ClipboardPaste /> Dán ảnh
            </Button>
            {rows.length === 0 && (
              <Button variant="outline" onClick={addManualRow} disabled={scanning}>
                <Plus /> Nhập thủ công
              </Button>
            )}
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
              <span className="rounded-md bg-info/15 px-2 py-1 text-info" title={stats.newNames.join(", ")}>
                {stats.newMembers} thành viên mới{stats.newMembers > 0 && stats.newMembers <= 5 ? `: ${stats.newNames.join(", ")}` : ""}
              </span>
              {stats.missing.length > 0 && rows.length > 0 && (
                <span className="rounded-md bg-warning/15 px-2 py-1 text-warning" title={stats.missing.join(", ")}>
                  {stats.missing.length} người lần trước có nhưng giờ không thấy
                  {stats.missing.length <= 5 ? `: ${stats.missing.join(", ")}` : ""}
                  {stats.newMembers > 0 ? " — có thể AI đọc sai Username, hãy so với cột Mới" : ""}
                </span>
              )}
              {memberTotal !== null && (
                <span className={cn("rounded-md px-2 py-1", memberTotal === stats.total ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                  {memberTotal === stats.total
                    ? `Khớp với "Members ${memberTotal}" trong game`
                    : `Game ghi ${memberTotal} người nhưng đang có ${stats.total} dòng — kiểm tra trùng/thiếu`}
                </span>
              )}
              {labels.columns.length > 0 && (
                <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">Cột thấy được: {labels.columns.join(", ")}</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Xác thực</th>
                    <th className="px-2 py-2 text-left font-medium">Username *</th>
                    <th className="px-2 py-2 text-left font-medium">Display Name</th>
                    <th className="px-2 py-2 text-left font-medium">Level</th>
                    <th className="px-2 py-2 text-left font-medium">Role</th>
                    <th className="px-2 py-2 text-left font-medium">Weekly KM</th>
                    <th className="px-2 py-2 text-left font-medium text-primary">KM tăng</th>
                    <th className="px-2 py-2 text-left font-medium">Donated</th>
                    <th className="px-2 py-2 text-left font-medium text-primary">Donate tăng</th>
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
                    const dl = deltas(r);
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
                        <td className="px-2 py-1.5 text-xs tabular whitespace-nowrap" title={dl.km.title}>
                          <span className={cn(dl.km.tone === "up" && "font-semibold text-success", dl.km.tone === "warn" && "text-warning", dl.km.tone === "muted" && "text-muted-foreground", dl.km.tone === "zero" && "text-destructive")}>
                            {dl.km.text}
                          </span>
                          {dl.since && dl.km.tone !== "muted" && <div className="text-[10px] text-muted-foreground">trong {dl.since}</div>}
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
                        <td className="px-2 py-1.5 text-xs tabular whitespace-nowrap" title={dl.donate.title}>
                          <span className={cn(dl.donate.tone === "up" && "font-semibold text-success", dl.donate.tone === "warn" && "text-warning", dl.donate.tone === "muted" && "text-muted-foreground", dl.donate.tone === "zero" && "text-destructive")}>
                            {dl.donate.text}
                          </span>
                          {dl.since && dl.donate.tone !== "muted" && <div className="text-[10px] text-muted-foreground">trong {dl.since}</div>}
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
                      <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
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
                <Label htmlFor="countdown">Đồng hồ reset KM trong ảnh</Label>
                <Input
                  id="countdown"
                  value={countdownText}
                  onChange={(e) => setCountdownText(e.target.value)}
                  placeholder="VD: 2d 05:12:33"
                  className={cn(countdownText.trim() && countdownSecs === null && "border-destructive")}
                />
                <p className="text-xs text-muted-foreground">
                  {nextReset ? (
                    <>
                      Reset tiếp theo: <b className="text-foreground">{fmtDateTime(nextReset.toISOString())}</b> (= thời điểm dữ liệu + đếm ngược).
                    </>
                  ) : countdownText.trim() ? (
                    <span className="text-destructive">Không hiểu định dạng — dùng dạng &quot;2d 5h 30m&quot; hoặc &quot;2d 05:30:00&quot;.</span>
                  ) : (
                    "AI tự đọc nếu ảnh có đồng hồ. Để trống nếu không có — hệ thống dùng mốc reset trong Settings."
                  )}
                </p>
                {resetMismatchMin !== null && resetMismatchMin > 15 && (
                  <p className="text-xs text-warning">
                    Lệch {resetMismatchMin} phút so với mốc reset ở ảnh trước ({fmtDateTime(lastNextResetAt)}). Kiểm tra lại thời điểm dữ liệu hoặc đồng hồ.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Ghi chú (tùy chọn)</Label>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            {stats.missing.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                {leftCandidates.length > 0 ? (
                  <>
                    <div className="font-medium">
                      Danh sách đủ {memberTotal} người — {leftCandidates.length} người không còn trong crew sẽ được đánh dấu &quot;Đã rời crew&quot;:
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {leftCandidates.map((u) => (
                        <label key={u} className="flex items-center gap-1.5 font-mono text-xs">
                          <Checkbox
                            checked={!keepInCrew.has(u)}
                            onCheckedChange={(v) =>
                              setKeepInCrew((prev) => {
                                const next = new Set(prev);
                                if (v) next.delete(u);
                                else next.add(u);
                                return next;
                              })
                            }
                          />
                          {u}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Bỏ tick nếu người đó vẫn còn trong crew (AI đọc sai tên). Người đã rời vẫn giữ toàn bộ lịch sử; mời lại thì tự kích hoạt lại.
                    </p>
                  </>
                ) : (
                  <div className="text-warning">
                    {stats.missing.length} người lần trước có nhưng ảnh này không thấy ({stats.missing.slice(0, 8).join(", ")}
                    {stats.missing.length > 8 ? "…" : ""}). Vì danh sách chưa đủ / không khớp số &quot;Members&quot; trong game nên hệ thống KHÔNG đánh dấu họ đã rời.
                  </div>
                )}
              </div>
            )}
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
