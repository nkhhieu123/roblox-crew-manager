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
    return process.env.OCR_MODEL?.trim() || "google/gemini-2.5-flash";
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
