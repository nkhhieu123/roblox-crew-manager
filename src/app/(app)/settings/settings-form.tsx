"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/app/native-select";
import type { GeneralSettings } from "@/lib/engine/types";
import { updateSettings } from "./actions";

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const TIMEZONES = ["Asia/Ho_Chi_Minh", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Singapore", "Asia/Tokyo"];

export function SettingsForm({ initial }: { initial: GeneralSettings }) {
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof GeneralSettings>(k: K, v: GeneralSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cài đặt chung</CardTitle>
        <CardDescription>Áp dụng cho cả hai quản lý. Thay đổi mốc reset sẽ có hiệu lực từ lần đánh giá tiếp theo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Mốc reset Weekly KM</Label>
          <div className="flex flex-wrap gap-2">
            <NativeSelect value={s.week_reset_weekday} onChange={(e) => set("week_reset_weekday", Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={s.week_reset_hour} onChange={(e) => set("week_reset_hour", Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-xs text-muted-foreground">
            Thời điểm game reset số km tuần. Nếu không chắc, hệ thống vẫn tự phát hiện khi số KM giảm và đánh dấu PENDING thay vì FAIL.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tz">Múi giờ</Label>
          <Input id="tz" list="tz-list" value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
          <datalist id="tz-list">
            {TIMEZONES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dtype">Loại Donate mặc định khi upload</Label>
          <NativeSelect id="dtype" value={s.default_donate_type} onChange={(e) => set("default_donate_type", e.target.value as GeneralSettings["default_donate_type"])} className="w-full">
            <option value="cumulative">Tổng tích lũy (all-time)</option>
            <option value="weekly">Theo tuần (reset mỗi tuần)</option>
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tol">Dung sai chọn snapshot gốc (%)</Label>
          <Input id="tol" type="number" min={0} max={50} value={s.baseline_tolerance_pct} onChange={(e) => set("baseline_tolerance_pct", Number(e.target.value))} className="w-28" />
          <p className="text-xs text-muted-foreground">
            Với chu kỳ 24h và dung sai 15%, snapshot gốc có thể cũ từ 20,4 giờ trở lên. Snapshot gần hơn không đủ để đánh giá → PENDING.
          </p>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <Switch checked={s.store_images} onCheckedChange={(v) => set("store_images", v)} />
          Lưu ảnh gốc vào Supabase Storage
        </label>

        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateSettings(s);
              if (r.ok) toast.success("Đã lưu cài đặt");
              else toast.error(r.error);
            })
          }
        >
          {pending ? "Đang lưu…" : "Lưu cài đặt"}
        </Button>
      </CardContent>
    </Card>
  );
}
