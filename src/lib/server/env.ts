import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing environment variable ${name}. See .env.example`);
  }
  return v.trim();
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get storageBucket() {
    return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "snapshots";
  },
  get authSecret() {
    const s = required("AUTH_SECRET");
    if (s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
    return s;
  },
  get ocrModel() {
    return process.env.OCR_MODEL?.trim() || "anthropic/claude-sonnet-5.5";
  },
  /** Direct Google Gemini (free tier, no credit card) — used instead of AI Gateway when the key is set. */
  get geminiKey() {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || null;
  },
  /** Models tried in order; when one runs out of free quota (or is overloaded) the next one is used. */
  get geminiModels(): string[] {
    const fromEnv = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return fromEnv.length
      ? fromEnv
      : ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
  },
  /** Human-readable name of the OCR engine in use. */
  get ocrEngine() {
    return this.geminiKey ? `Gemini API: ${this.geminiModels.join(" → ")}` : `${this.ocrModel} (AI Gateway)`;
  },
  get managers(): { name: string; password: string }[] {
    const list: { name: string; password: string }[] = [];
    for (const i of [1, 2]) {
      const name = process.env[`MANAGER_${i}_NAME`]?.trim();
      const password = process.env[`MANAGER_${i}_PASSWORD`];
      if (name && password) list.push({ name, password });
    }
    return list;
  },
};
