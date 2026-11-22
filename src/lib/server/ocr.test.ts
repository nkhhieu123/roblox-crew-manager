import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: { ocrModel: "test/model" } }));

const { normalizeOcr } = await import("./ocr");

const row = (over: Record<string, unknown> = {}) => ({
  image_index: 1,
  username: "Player123",
  display_name: "Cool Player",
  level_text: "Lv. 42",
  role: "Member",
  weekly_km_text: "15.000 km",
  donated_text: "1,200",
  last_seen: "Online",
  uncertain: false,
  note: null,
  ...over,
});

describe("normalizeOcr", () => {
  it("parses numbers from raw text and keeps confident rows verified", () => {
    const r = normalizeOcr({ is_member_list: true, columns_visible: [], member_total: null, km_label: "Weekly KM", donate_label: "Donated", reset_countdown_text: "Resets in 2d 05:12:33", rows: [row()] }, "m");
    expect(r.rows[0]).toMatchObject({
      username: "Player123",
      level: 42,
      weekly_km: 15000,
      donated: 1200,
      needs_review: false,
    });
    expect(r.reset_in_seconds).toBe(2 * 86400 + 5 * 3600 + 12 * 60 + 33);
  });

  it("keeps unreadable values null and flags the row — never guesses", () => {
    const r = normalizeOcr(
      { is_member_list: true, columns_visible: [], member_total: null, km_label: null, donate_label: null, reset_countdown_text: null, rows: [row({ weekly_km_text: null, donated_text: "1,2?0", uncertain: true, note: "blurry" })] },
      "m",
    );
    expect(r.rows[0].weekly_km).toBeNull();
    expect(r.rows[0].donated).toBeNull();
    expect(r.rows[0].needs_review).toBe(true);
    expect(r.rows[0].review_notes).toContain("blurry");
  });

  it("drops clipped rows that contain no usable data", () => {
    const r = normalizeOcr(
      { is_member_list: true, columns_visible: [], member_total: 30, km_label: null, donate_label: null, reset_countdown_text: null, rows: [row({ username: null, display_name: null, weekly_km_text: null, donated_text: null, uncertain: true }), row()] },
      "m",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.member_total).toBe(30);
  });

  it("flags missing or invalid usernames", () => {
    const r = normalizeOcr(
      { is_member_list: true, columns_visible: [], member_total: null, km_label: null, donate_label: null, reset_countdown_text: null, rows: [row({ username: null }), row({ username: "@bad name!" })] },
      "m",
    );
    expect(r.rows[0].needs_review).toBe(true);
    expect(r.rows[0].username).toBe("");
    expect(r.rows[1].needs_review).toBe(true);
  });
});
