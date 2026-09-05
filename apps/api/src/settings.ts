import type { DatabaseSync } from "node:sqlite";

// Admin-editable system limits. Values live in SQLite when the app runs on
// the sqlite driver (seeded from env defaults on first boot); test builds with
// injected repositories fall back to in-memory maps. envNumber(...) stays the
// source of defaults so existing deployments keep their tuned env values.

export type SystemSettings = {
  generalRateLimitPerMinute: number;
  maxExamsPerUser: number;
  maxQuestionsPerExam: number;
  maxSharesPerUser: number;
};

const KEYS: Record<keyof SystemSettings, string> = {
  generalRateLimitPerMinute: "GENERAL_RATE_LIMIT_PER_MINUTE",
  maxExamsPerUser: "MAX_EXAMS_PER_USER",
  maxQuestionsPerExam: "MAX_QUESTIONS_PER_EXAM",
  maxSharesPerUser: "MAX_SHARES_PER_USER"
};
// hard ceilings: a compromised admin session cannot disable all protection
export const SETTING_RANGES: Record<keyof SystemSettings, { min: number; max: number }> = {
  generalRateLimitPerMinute: { min: 10, max: 10_000 },
  maxExamsPerUser: { min: 1, max: 10_000 },
  maxQuestionsPerExam: { min: 1, max: 1_000 },
  maxSharesPerUser: { min: 1, max: 10_000 }
};

let db: DatabaseSync | undefined;
let seeded = false;
const memory = new Map<string, number>();
// Settings change only via setSettings; the general rate limiter reads them on
// every request, so cache one resolved object and invalidate on write.
let cache: SystemSettings | undefined;

export function initSettings(database?: DatabaseSync, defaults?: SystemSettings) { memory.clear(); cache = undefined; db = database; seeded = false; seed(defaults); }

function seed(defaults?: SystemSettings) {
  if (seeded) return; seeded = true;
  if (!db) {
    if (defaults) for (const [field, key] of Object.entries(KEYS) as Array<[keyof SystemSettings, string]>) memory.set(key, Number(defaults[field]));
    return;
  }
  db.exec(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)`);
  for (const [field, key] of Object.entries(KEYS)) {
    const fallback = defaults ? defaults[field as keyof SystemSettings] : envDefault(key);
    db.prepare("INSERT OR IGNORE INTO system_settings(key,value,updated_at) VALUES(?,?,0)").run(key, fallback);
  }
}

function envDefault(key: string): number {
  switch (key) {
    case "GENERAL_RATE_LIMIT_PER_MINUTE": return envNumberLocal("RATE_LIMIT_PER_MINUTE", 120, 1, 10_000);
    case "MAX_EXAMS_PER_USER": return envNumberLocal("MAX_EXAMS_PER_USER", 200, 1, 10_000);
    case "MAX_QUESTIONS_PER_EXAM": return envNumberLocal("MAX_QUESTIONS_PER_EXAM", 300, 1, 1_000);
    default: return envNumberLocal("MAX_SHARES_PER_USER", 100, 1, 10_000);
  }
}
function envNumberLocal(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function getSettings(): SystemSettings {
  if (cache) return cache;
  const clamp = (field: keyof SystemSettings, value: number) => {
    const range = SETTING_RANGES[field];
    return Math.min(range.max, Math.max(range.min, value));
  };
  const read = (field: keyof SystemSettings) => {
    const key = KEYS[field];
    if (db) {
      const row = db.prepare("SELECT value FROM system_settings WHERE key=?").get(key) as any;
      if (row !== undefined && Number.isFinite(Number(row.value))) return clamp(field, Number(row.value));
    } else if (memory.has(key)) return clamp(field, memory.get(key)!);
    return clamp(field, envDefault(key));
  };
  cache = {
    generalRateLimitPerMinute: read("generalRateLimitPerMinute"),
    maxExamsPerUser: read("maxExamsPerUser"),
    maxQuestionsPerExam: read("maxQuestionsPerExam"),
    maxSharesPerUser: read("maxSharesPerUser")
  };
  return cache;
}

export function setSettings(patch: Partial<SystemSettings>, updatedBy: string): SystemSettings {
  seed(); cache = undefined;
  const now = Date.now();
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const range = SETTING_RANGES[field as keyof SystemSettings];
    if (!range || !Number.isInteger(value) || value < range.min || value > range.max) throw new Error("INVALID_SETTING");
    if (db) db.prepare("INSERT INTO system_settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(KEYS[field as keyof SystemSettings], value, now, updatedBy);
    else memory.set(KEYS[field as keyof SystemSettings], value);
  }
  return getSettings();
}
