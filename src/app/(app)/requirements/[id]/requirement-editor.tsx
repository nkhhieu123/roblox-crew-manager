"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { cn } from "@/lib/utils";
import { buildRuleTree, describeTree } from "@/lib/engine/rules";
import type { ConditionNode, GroupNode, Mode, RequirementConfig, RuleNode } from "@/lib/engine/types";
import { saveRequirementSet } from "../actions";

const WINDOWS = [6, 12, 24, 48];

const splitNames = (s: string) =>
  Array.from(new Set(s.split(/[\s,;]+/).map((x) => x.trim().replace(/^@/, "")).filter(Boolean)));

export function RequirementEditor({
  initial,
}: {
  initial: { id: string | null; name: string; description: string; config: RequirementConfig };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [cfg, setCfg] = useState<RequirementConfig>(initial.config);
  const [customWindow, setCustomWindow] = useState(!WINDOWS.includes(initial.config.window_hours));
  const [included, setIncluded] = useState(initial.config.included_usernames.join(", "));
  const [exempt, setExempt] = useState(initial.config.exempt_usernames.join(", "));
  const [pending, start] = useTransition();

  const set = <K extends keyof RequirementConfig>(k: K, v: RequirementConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const preview = describeTree(buildRuleTree(cfg));

  function save() {
    const config: RequirementConfig = {
      ...cfg,
      included_usernames: splitNames(included),
      exempt_usernames: splitNames(exempt),
    };
    start(async () => {
      const r = await saveRequirementSet({ id: initial.id, name, description: description.trim() || null, config });
      if (!r.ok) return void toast.error(r.error);
      toast.success(initial.id ? "Đã lưu phiên bản mới" : "Đã tạo bộ điều kiện");
      router.push("/requirements");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Tên bộ điều kiện</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Tiêu chuẩn 24h" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Cách tính kỳ đánh giá</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["daily", "Theo ngày", "Mỗi ngày từ 0 giờ đến 0 giờ hôm sau. Hết ngày ai chưa đạt → FAIL."],
                    ["rolling", "Theo chu kỳ trượt", "N giờ gần nhất tính từ mỗi lần chụp (6/12/24/48 giờ…)."],
                  ] as const
                ).map(([v, title, desc]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set("period", v)}
                    className={cn("rounded-lg border p-3 text-left transition-colors", cfg.period === v ? "border-primary bg-primary/10" : "hover:bg-muted/40")}
                  >
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </button>
                ))}
              </div>
              {cfg.period === "daily" && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Ngày bắt đầu lúc</span>
                  <NativeSelect value={cfg.day_start_hour} onChange={(e) => set("day_start_hour", Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </NativeSelect>
                  <span className="text-muted-foreground">(giờ Việt Nam)</span>
                </div>
              )}
            </div>
            <div className={cn("space-y-2", cfg.period === "daily" && "hidden")}>
              <Label>Khoảng thời gian đánh giá</Label>
              <div className="flex flex-wrap gap-2">
                {WINDOWS.map((w) => (
                  <Button
                    key={w}
                    type="button"
                    size="sm"
                    variant={!customWindow && cfg.window_hours === w ? "default" : "outline"}
                    onClick={() => {
                      setCustomWindow(false);
                      set("window_hours", w);
                    }}
                  >
                    {w} giờ
                  </Button>
                ))}
                <Button type="button" size="sm" variant={customWindow ? "default" : "outline"} onClick={() => setCustomWindow(true)}>
                  Tự nhập
                </Button>
                {customWindow && (
                  <Input
                    type="number"
                    min={1}
                    className="h-7 w-24"
                    value={cfg.window_hours}
                    onChange={(e) => set("window_hours", Number(e.target.value))}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="desc">Mô tả (tùy chọn)</Label>
              <Textarea id="desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Điều kiện</CardTitle>
            <CardDescription>Số KM / Donate là mức tăng trong khoảng thời gian đánh giá (snapshot sau − snapshot trước).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["ANY", "ANY", "Đạt ít nhất 1 điều kiện"],
                  ["ALL", "ALL", "Phải đạt tất cả"],
                  ["CUSTOM", "CUSTOM", "Tự kết hợp AND / OR"],
                ] as [Mode, string, string][]
              ).map(([m, title, desc]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set("mode", m)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    cfg.mode === m ? "border-primary bg-primary/10" : "hover:bg-muted/40",
                  )}
                >
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              ))}
            </div>

            {cfg.mode !== "CUSTOM" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border p-3">
                  <label className="flex items-center justify-between text-sm font-medium">
                    Điều kiện KM
                    <Switch checked={cfg.use_km} onCheckedChange={(v) => set("use_km", v)} />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">KM tăng ≥</span>
                    <Input
                      type="number"
                      min={0}
                      disabled={!cfg.use_km}
                      value={cfg.min_km}
                      onChange={(e) => set("min_km", Number(e.target.value))}
                      className="w-32"
                    />
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border p-3">
                  <label className="flex items-center justify-between text-sm font-medium">
                    Điều kiện Donate
                    <Switch checked={cfg.use_donate} onCheckedChange={(v) => set("use_donate", v)} />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Donate tăng ≥</span>
                    <Input
                      type="number"
                      min={0}
                      disabled={!cfg.use_donate}
                      value={cfg.min_donate}
                      onChange={(e) => set("min_donate", Number(e.target.value))}
                      className="w-32"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <GroupEditor node={cfg.custom} onChange={(n) => set("custom", n)} root />
            )}

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">PASS khi: </span>
              <span className="font-mono">{preview}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="warn">WARNING khi đạt từ</Label>
              <Input
                id="warn"
                type="number"
                min={0}
                max={99}
                value={cfg.warning_pct}
                onChange={(e) => set("warning_pct", Number(e.target.value))}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">% yêu cầu trở lên (0 = tắt). Người gần đạt sẽ là WARNING thay vì FAIL.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phạm vi & ngoại lệ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={cfg.applies_to_all} onCheckedChange={(v) => set("applies_to_all", v)} />
              Áp dụng cho toàn bộ thành viên
            </label>
            {!cfg.applies_to_all && (
              <div className="space-y-2">
                <Label>Chỉ áp dụng cho các Username sau</Label>
                <Textarea rows={3} value={included} onChange={(e) => setIncluded(e.target.value)} placeholder="Player123, Player456 …" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Ngoại lệ — Username được miễn điều kiện này</Label>
              <Textarea rows={3} value={exempt} onChange={(e) => setExempt(e.target.value)} placeholder="Ngăn cách bằng dấu phẩy hoặc xuống dòng" />
              <p className="text-xs text-muted-foreground">Ngoài ra có thể đánh dấu miễn điều kiện vĩnh viễn ở trang Members.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="sticky top-6">
          <CardHeader>
            <CardTitle className="text-base">Tóm tắt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {cfg.period === "daily" ? (
                <>
                  Mỗi ngày <b>{String(cfg.day_start_hour).padStart(2, "0")}:00 → {String(cfg.day_start_hour).padStart(2, "0")}:00</b> hôm sau, thành viên PASS khi:
                </>
              ) : (
                <>
                  Trong mỗi <b>{cfg.window_hours} giờ</b>, thành viên PASS khi:
                </>
              )}
            </p>
            <p className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{preview}</p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Thiếu dữ liệu hoặc Weekly KM bị reset mà chưa xác định được → PENDING (không tự kết luận FAIL).</li>
              <li>Nếu khoảng cách thực tế giữa 2 snapshot dài hơn chu kỳ, yêu cầu được nhân theo tỷ lệ.</li>
            </ul>
            <Button className="w-full" onClick={save} disabled={pending}>
              {pending ? "Đang lưu…" : initial.id ? "Lưu phiên bản mới" : "Tạo bộ điều kiện"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GroupEditor({ node, onChange, onRemove, root }: { node: GroupNode; onChange: (n: GroupNode) => void; onRemove?: () => void; root?: boolean }) {
  const updateChild = (i: number, child: RuleNode) => onChange({ ...node, children: node.children.map((c, j) => (j === i ? child : c)) });
  const removeChild = (i: number) => onChange({ ...node, children: node.children.filter((_, j) => j !== i) });
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", !root && "bg-muted/20")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{root ? "Nhóm gốc:" : "Nhóm:"} kết hợp bằng</span>
        <NativeSelect value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as "AND" | "OR" })} className="h-7">
          <option value="AND">AND (và)</option>
          <option value="OR">OR (hoặc)</option>
        </NativeSelect>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onChange({ ...node, children: [...node.children, { type: "cond", metric: "km", op: ">=", value: 5000 }] })}
          >
            <Plus /> Điều kiện
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onChange({ ...node, children: [...node.children, { type: "group", op: "AND", children: [] }] })}
          >
            <FolderPlus /> Nhóm
          </Button>
          {onRemove && (
            <Button type="button" size="icon-xs" variant="ghost" onClick={onRemove} aria-label="Xóa nhóm">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {node.children.length === 0 && <p className="text-xs text-muted-foreground">Nhóm trống.</p>}
      {node.children.map((c, i) => (
        <div key={i} className="flex items-start gap-2">
          {i > 0 && <span className="mt-1.5 w-8 shrink-0 text-center text-[11px] font-semibold text-primary">{node.op}</span>}
          {i === 0 && <span className="w-8 shrink-0" />}
          <div className="flex-1">
            {c.type === "group" ? (
              <GroupEditor node={c} onChange={(n) => updateChild(i, n)} onRemove={() => removeChild(i)} />
            ) : (
              <CondEditor node={c} onChange={(n) => updateChild(i, n)} onRemove={() => removeChild(i)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CondEditor({ node, onChange, onRemove }: { node: ConditionNode; onChange: (n: ConditionNode) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={node.metric} onChange={(e) => onChange({ ...node, metric: e.target.value as "km" | "donate" })} className="h-7">
        <option value="km">KM tăng</option>
        <option value="donate">Donate tăng</option>
      </NativeSelect>
      <NativeSelect value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as ">=" | ">" })} className="h-7">
        <option value=">=">≥</option>
        <option value=">">&gt;</option>
      </NativeSelect>
      <Input type="number" min={0} value={node.value} onChange={(e) => onChange({ ...node, value: Number(e.target.value) })} className="h-7 w-28" />
      <Button type="button" size="icon-xs" variant="ghost" onClick={onRemove} aria-label="Xóa điều kiện">
        <Trash2 />
      </Button>
    </div>
  );
}
