import { mkdir } from 'node:fs/promises';
import type { AppConfig } from './config.ts';
import type { Db } from './db/db.ts';
import { waitForDatabase, migrate } from './db/db.ts';
import { countUsers, createUser, findByEmail } from './db/repos/users.ts';
import { hashPassword, validatePasswordStrength } from './auth/password.ts';
import { setSetting } from './db/settings.ts';
import { writeAudit } from './db/repos/audit.ts';
import { recoverExpiredArtifacts } from './jobs/recovery.ts';

type Logger = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export async function prepareApplication(config: AppConfig, db: Db, log: Logger): Promise<void> {
  await Promise.all([
    mkdir(config.dataDir, { recursive: true }),
    mkdir(config.uploadsDir, { recursive: true, mode: 0o700 }),
    mkdir(config.outputsDir, { recursive: true, mode: 0o700 }),
    mkdir(config.tmpDir, { recursive: true, mode: 0o700 }),
  ]);
  await waitForDatabase(db);
  await migrate(db);

  const users = await countUsers(db);
  if (users === 0) {
    if (!config.adminPassword) {
      if (config.env === 'production') {
        throw new Error('ADMIN_PASSWORD must be set when bootstrapping an empty ConvertLab database');
      }
      config.adminPassword = 'change-me-please';
    }
    const strength = validatePasswordStrength(config.adminPassword);
    if (strength) throw new Error(`ADMIN_PASSWORD is invalid: ${strength}`);
    const existing = await findByEmail(db, config.adminEmail);
    if (!existing) {
      // The web and worker roles both run this bootstrap on a cold start, so a
      // concurrent insert can lose the race; treat the resulting unique
      // violation as success and let the other process own the audit entry.
      try {
        const admin = await createUser(db, {
          email: config.adminEmail,
          passwordHash: await hashPassword(config.adminPassword),
          role: 'admin',
        });
        await setSetting(db, 'registrationOpen', config.allowRegistration);
        await writeAudit(db, {
          actorId: admin.id,
          action: 'system.admin_bootstrap',
          targetType: 'user',
          targetId: admin.id,
          detail: { email: admin.email },
        });
        log('warn', 'bootstrap administrator created', { email: admin.email });
      } catch (error) {
        if (isUniqueViolation(error)) {
          log('info', 'administrator already created by another process', { email: config.adminEmail });
        } else {
          throw error;
        }
      }
    }
  } else {
    log('info', 'database ready', { users });
  }
  await recoverExpiredArtifacts(db, log);
}
