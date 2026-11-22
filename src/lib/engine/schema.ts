import { z } from "zod";
import type { GroupNode, RuleNode } from "./types";

const condSchema = z.object({
  type: z.literal("cond"),
  metric: z.enum(["km", "donate"]),
  op: z.enum([">=", ">"]),
  value: z.number().finite().nonnegative(),
});

export const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    condSchema,
    z.object({
      type: z.literal("group"),
      op: z.enum(["AND", "OR"]),
      children: z.array(ruleNodeSchema).max(30),
    }),
  ]),
);

export const requirementConfigSchema = z
  .object({
    period: z.enum(["daily", "rolling"]),
    day_start_hour: z.number().int().min(0).max(23),
    window_hours: z.number().finite().min(1, "Chu kỳ tối thiểu 1 giờ").max(24 * 31, "Chu kỳ tối đa 31 ngày"),
    mode: z.enum(["ANY", "ALL", "CUSTOM"]),
    use_km: z.boolean(),
    min_km: z.number().finite().nonnegative(),
    use_donate: z.boolean(),
    min_donate: z.number().finite().nonnegative(),
    custom: ruleNodeSchema.refine((n): n is GroupNode => n.type === "group", "Gốc phải là nhóm"),
    warning_pct: z.number().min(0).max(99),
    applies_to_all: z.boolean(),
    included_usernames: z.array(z.string().trim().min(1)).max(2000),
    exempt_usernames: z.array(z.string().trim().min(1)).max(2000),
  })
  .superRefine((c, ctx) => {
    if (c.mode !== "CUSTOM" && !c.use_km && !c.use_donate) {
      ctx.addIssue({ code: "custom", message: "Cần bật ít nhất một điều kiện (KM hoặc Donate)" });
    }
    if (c.mode === "CUSTOM") {
      const count = (n: RuleNode): number => (n.type === "cond" ? 1 : n.children.reduce((a, x) => a + count(x), 0));
      if (count(c.custom) === 0) ctx.addIssue({ code: "custom", message: "Điều kiện tùy chỉnh đang trống" });
    }
  });
