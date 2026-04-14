import Redis from 'ioredis';
import { env } from '../config/env';

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
  }
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await getRedisClient().get(key);
  } catch {
    return null; // fail open
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedisClient().set(key, value, 'EX', ttlSeconds);
  } catch {
    // fail open
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // fail open
  }
}
