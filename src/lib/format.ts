export function fmtNum(n: number | string | null | undefined, digits = 0): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

/** Gain with "≥" prefix when the value is only a lower bound. */
export function fmtGain(n: number | string | null | undefined, exact: boolean | null | undefined): string {
  if (n === null || n === undefined) return "Chưa rõ";
  return `${exact === false ? "≥ " : ""}${fmtNum(n)}`;
}

const TZ = "Asia/Ho_Chi_Minh";

export function fmtDateTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function fmtDate(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtHours(h: number | string | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const v = Number(h);
  if (v >= 48) return `${fmtNum(v / 24, 1)} ngày`;
  return `${fmtNum(v, 1)} giờ`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

/** Value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
