import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getManager } from "@/lib/server/session";
import { parseViolationFilters, queryViolations, type ViolationRow } from "@/lib/server/violations";
import { audit } from "@/lib/server/audit";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const HEADERS = [
  "Username",
  "Trạng thái",
  "KM đã đạt",
  "KM chính xác?",
  "KM yêu cầu",
  "Donate đã đạt",
  "Donate chính xác?",
  "Donate yêu cầu",
  "Khoảng thời gian (giờ)",
  "Từ",
  "Đến",
  "Lý do",
  "Chi tiết",
  "Thời điểm phát hiện",
  "Vi phạm liên tiếp",
  "Bộ điều kiện",
  "Đã xử lý",
  "Người xử lý",
  "Ghi chú xử lý",
];

function toRow(r: ViolationRow) {
  const n = (v: number | null) => (v === null ? null : Number(v));
  return [
    r.username,
    r.status,
    n(r.km_gain),
    r.km_gain === null ? "" : r.km_gain_exact ? "Có" : "Tối thiểu",
    n(r.km_required),
    n(r.donate_gain),
    r.donate_gain === null ? "" : r.donate_gain_exact ? "Có" : "Tối thiểu",
    n(r.donate_required),
    n(r.hours),
    fmtDateTime(r.from_captured_at),
    fmtDateTime(r.to_captured_at),
    r.reason_summary ?? "",
    r.reasons.join(" | "),
    fmtDateTime(r.created_at),
    r.consecutive_fails,
    r.evaluations.requirement_name,
    r.resolved ? "Đã xử lý" : "Chưa",
    r.resolved_by ?? "",
    r.resolution_note ?? "",
  ];
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  const manager = await getManager();
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filters = parseViolationFilters(Object.fromEntries(url.searchParams));
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const { rows } = await queryViolations(filters);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  await audit(manager, "violation.export", null, null, { format, count: rows.length, filters });

  if (format === "csv") {
    const lines = [HEADERS, ...rows.map(toRow)].map((r) => r.map(csvCell).join(","));
    return new NextResponse("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="violations-${stamp}.csv"`,
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Crew Manager";
  const ws = wb.addWorksheet("Violations");
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(toRow(r).map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v)));
  ws.columns.forEach((c, i) => {
    c.width = [18, 10, 12, 12, 12, 12, 12, 12, 10, 18, 18, 30, 60, 18, 10, 24, 10, 14, 30][i] ?? 14;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="violations-${stamp}.xlsx"`,
    },
  });
}
