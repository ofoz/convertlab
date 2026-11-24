import type { Db } from './db.ts';

export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const row = await db.one('SELECT value FROM app_settings WHERE key = $1', [key]);
  return row ? (row.value as T) : undefined;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export async function isRegistrationOpen(db: Db, fallback: boolean): Promise<boolean> {
  const stored = await getSetting<boolean>(db, 'registrationOpen');
  return typeof stored === 'boolean' ? stored : fallback;
}
