import { execSync } from 'child_process';
import path from 'path';

/**
 * Runs `prisma migrate deploy` to apply all pending migrations.
 * Logs migration name and timestamp on success.
 * On failure, logs the full error and exits with code 1.
 */
export async function runMigrations(): Promise<void> {
  const timestamp = new Date().toISOString();
  const migrationName = '20240101000000_init';

  try {
    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma');
    const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');

    execSync(`"${prismaBin}" migrate deploy --schema "${schemaPath}"`, {
      stdio: 'pipe',
      env: { ...process.env },
    });

    console.log(`[migrate] Migration applied: ${migrationName} at ${timestamp}`);
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const stderr = error.stderr?.toString() ?? '';
    const stdout = error.stdout?.toString() ?? '';
    const message = error.message ?? String(err);

    console.error(`[migrate] Migration failed at ${timestamp}`);
    console.error(`[migrate] Error: ${message}`);
    if (stdout) console.error(`[migrate] stdout: ${stdout}`);
    if (stderr) console.error(`[migrate] stderr: ${stderr}`);

    process.exit(1);
  }
}
