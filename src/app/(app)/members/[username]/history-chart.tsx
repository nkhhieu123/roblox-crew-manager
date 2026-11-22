"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateTime, fmtNum } from "@/lib/format";

export function MemberHistoryChart({ data }: { data: { t: string; km: number | null; donated: number | null }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis yAxisId="km" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtNum(v)} width={56} />
          <YAxis yAxisId="don" orientation="right" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtNum(v)} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => fmtDateTime(String(v))}
            formatter={(v, name) => [fmtNum(v as number), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="km" type="monotone" dataKey="km" name="Weekly KM" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="don" type="monotone" dataKey="donated" name="Donated" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
