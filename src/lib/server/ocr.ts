import "server-only";
import { generateText, Output } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { env } from "./env";
import { cleanUsername, parseInteger, parseNumber } from "@/lib/engine/parse";
import { parseCountdown } from "@/lib/engine/week";

const rowSchema = z.object({
  username: z.string().nullable().describe("Roblox account username exactly as shown (usually the small '@name' text), without '@'. null if not visible/unreadable."),
  display_name: z.string().nullable().describe("Display name (usually the larger name). null if not visible."),
  level_text: z.string().nullable().describe("Level exactly as shown, e.g. 'Lv. 42' or '42'. null if not visible."),
  role: z.string().nullable().describe("Crew role/rank text exactly as shown. null if not visible."),
  weekly_km_text: z.string().nullable().describe("Weekly KM value exactly as shown, including separators and suffixes, e.g. '15.000 km'. null if not visible."),
  donated_text: z.string().nullable().describe("Donated value exactly as shown, e.g. '1,200' or '3.5K'. null if not visible."),
  last_seen: z.string().nullable().describe("Last seen / last online text exactly as shown, e.g. 'Online', '2h ago'. null if not visible."),
  uncertain: z.boolean().describe("true if ANY field of this row is blurry, cut off, partially hidden or you are not fully sure about a character."),
  note: z.string().nullable().describe("Short note about what is uncertain, else null."),
});

const ocrSchema = z.object({
  is_member_list: z.boolean().describe("true if the image shows a Roblox crew/group members list"),
  columns_visible: z.array(z.string()).describe("Column headers / stat labels visible in the image, verbatim"),
  member_total: z
    .number()
    .nullable()
    .describe("Total crew member count shown in a header such as 'Members 30 / 30' (the first number). null if not visible"),
  km_label: z.string().nullable().describe("Exact label/header of the KM stat, e.g. 'Weekly KM'. null if none"),
  donate_label: z.string().nullable().describe("Exact label/header of the donation stat, e.g. 'Donated', 'Weekly Donations'. null if none"),
  reset_countdown_text: z
    .string()
    .nullable()
    .describe("The weekly reset countdown timer exactly as shown (e.g. 'Resets in 2d 05:12:33'), including its label. null if no countdown is visible"),
  rows: z.array(rowSchema),
});

export type OcrOutput = z.infer<typeof ocrSchema>;

const PROMPT = `You are a meticulous OCR engine reading a screenshot of a Roblox crew "Members" list.
Extract EVERY member row visible in the image, top to bottom.

STRICT RULES:
- Copy text EXACTLY as displayed. Do not translate, correct, round or reformat numbers.
- NEVER guess. If a value is not visible, cut off or unreadable, return null for it and set "uncertain": true.
- Usernames are critical identifiers: Roblox usernames contain only letters, digits and underscore. Distinguish carefully between similar characters (l/I/1, O/0, rn/m, S/5, B/8). The game uses a small condensed font where a/o, i/j/l, v/y, u/v are easily confused — read the small "@username" text letter by letter. If unsure about any character, set "uncertain": true and explain in "note".
- A row at the top or bottom edge of the list that is partially hidden/cut off MUST have "uncertain": true (its small @username text is usually clipped).
- If a row shows only one name, put it in display_name and leave username null unless it is clearly the @username.
- Ignore rows that are cut off so badly that the name cannot be read at all.
- Do not invent rows. Do not include header rows or UI buttons.
- If a countdown/timer until the weekly reset is visible anywhere (e.g. "Resets in 2d 5h", "04:12:33"), copy it verbatim into reset_countdown_text.
- Report the stat labels exactly (e.g. "Weekly KM", "Donated") so the system can tell weekly values from all-time totals.`;

export interface OcrRow {
  username: string;
  display_name: string | null;
  level: number | null;
  role: string | null;
  weekly_km: number | null;
  donated: number | null;
  last_seen_text: string | null;
  needs_review: boolean;
  review_notes: string | null;
  raw: z.infer<typeof rowSchema>;
}

export interface OcrResult {
  model: string;
  is_member_list: boolean;
  km_label: string | null;
  donate_label: string | null;
  reset_countdown_text: string | null;
  member_total: number | null;
  /** seconds until the weekly reset at the moment of the screenshot, null if not visible/unreadable */
  reset_in_seconds: number | null;
  columns_visible: string[];
  rows: OcrRow[];
  raw: OcrOutput;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,40}$/;

/** Convert raw model output into typed rows. Anything ambiguous is flagged for manual review. */
export function normalizeOcr(out: OcrOutput, model: string): OcrResult {
  const rows: OcrRow[] = [];
  for (const r of out.rows) {
    // a clipped row with neither a username nor any number carries no usable data (e.g. a row cut off
    // at the edge, or an item from another panel) — drop it instead of creating an empty member row
    if (!r.username?.trim() && !r.weekly_km_text?.trim() && !r.donated_text?.trim()) continue;
    const notes: string[] = [];
    let needs = r.uncertain;
    if (r.note) notes.push(r.note);

    let username = r.username ? cleanUsername(r.username) : "";
    if (!username) {
      needs = true;
      notes.push("Không đọc được Username — cần nhập tay");
      username = "";
    } else if (!USERNAME_RE.test(username)) {
      needs = true;
      notes.push("Username có ký tự không hợp lệ");
    }

    const km = parseNumber(r.weekly_km_text);
    if (r.weekly_km_text && km === null) {
      needs = true;
      notes.push(`Không đọc được số KM "${r.weekly_km_text}"`);
    }
    const donated = parseNumber(r.donated_text);
    if (r.donated_text && donated === null) {
      needs = true;
      notes.push(`Không đọc được số Donate "${r.donated_text}"`);
    }
    const level = parseInteger(r.level_text?.replace(/lv\.?|level/gi, ""));

    rows.push({
      username,
      display_name: r.display_name?.trim() || null,
      level,
      role: r.role?.trim() || null,
      weekly_km: km,
      donated,
      last_seen_text: r.last_seen?.trim() || null,
      needs_review: needs,
      review_notes: notes.length ? notes.join("; ") : null,
      raw: r,
    });
  }
  return {
    model,
    is_member_list: out.is_member_list,
    km_label: out.km_label,
    donate_label: out.donate_label,
    reset_countdown_text: out.reset_countdown_text ?? null,
    member_total: out.member_total ?? null,
    reset_in_seconds: parseCountdown(out.reset_countdown_text),
    columns_visible: out.columns_visible,
    rows,
    raw: out,
  };
}

export async function runOcr(image: Uint8Array, mediaType: string): Promise<OcrResult> {
  // Gemini API key (free tier) takes priority; otherwise go through Vercel AI Gateway
  const model = env.geminiKey ? `google/${env.geminiModel}` : env.ocrModel;
  const { output } = await generateText({
    model: env.geminiKey ? google(env.geminiModel) : env.ocrModel,
    temperature: 0,
    maxRetries: 2,
    output: Output.object({ schema: ocrSchema }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "file", mediaType, data: image },
        ],
      },
    ],
  });
  return normalizeOcr(output, model);
}
