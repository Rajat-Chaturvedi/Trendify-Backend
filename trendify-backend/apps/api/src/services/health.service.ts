import { prisma } from '../lib/prisma';

export function liveness(): { status: 'ok' } {
  return { status: 'ok' };
}

export async function readiness(): Promise<{ status: 'ok' | 'unavailable'; reason?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch {
    return { status: 'unavailable', reason: 'database' };
  }
}
