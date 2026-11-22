"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateTime, fmtNum } from "@/lib/format";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Empty() {
  return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Chưa đủ dữ liệu</div>;
}

const META = {
  km: { name: "KM", color: "var(--chart-1)" },
  donate: { name: "Donate", color: "var(--chart-2)" },
  active: { name: "Thành viên hoạt động", color: "var(--chart-5)" },
} as const;

export function DailyCharts({ data, metric }: { data: { day: string; km: number; donate: number; active: number }[]; metric: keyof typeof META }) {
  if (!data.some((d) => d[metric] > 0)) return <Empty />;
  const m = META[metric];
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" {...axis} tickFormatter={(v: string) => v.slice(8, 10) + "/" + v.slice(5, 7)} minTickGap={16} />
          <YAxis {...axis} tickFormatter={(v: number) => fmtNum(v)} width={56} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v) => [fmtNum(v as number), m.name]} />
          <Bar dataKey={metric} fill={m.color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PassRateChart({ data }: { data: ({ t: string } & Record<string, number | string>)[] }) {
  if (data.length === 0) return <Empty />;
  const rows = data.map((d) => {
    const total = Number(d.total ?? 0) - Number(d.EXEMPT ?? 0);
    return {
      t: d.t,
      rate: total > 0 ? Math.round((Number(d.PASS ?? 0) / total) * 1000) / 10 : 0,
      fail: total > 0 ? Math.round((Number(d.FAIL ?? 0) / total) * 1000) / 10 : 0,
    };
  });
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            {...axis}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
            minTickGap={16}
          />
          <YAxis {...axis} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={44} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDateTime(String(v))} formatter={(v, n) => [`${v}%`, n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="rate" name="PASS" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="fail" name="FAIL" stroke="var(--destructive)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TopMembersChart({ data, color }: { data: { username: string; value: number }[]; color: string }) {
  if (data.length === 0) return <Empty />;
  return (
    <div className="w-full" style={{ height: Math.max(160, data.length * 30 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" {...axis} tickFormatter={(v: number) => fmtNum(v)} />
          <YAxis type="category" dataKey="username" {...axis} width={110} tick={{ fontSize: 11, fill: "var(--foreground)" }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v) => [fmtNum(v as number), "Tăng"]} />
          <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
