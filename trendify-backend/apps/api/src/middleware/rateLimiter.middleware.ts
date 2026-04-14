import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { env } from '../config/env';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
  }
  return redisClient;
}

const WINDOW_MS = 60_000; // 1 minute
const UNAUTH_LIMIT = 100;
const AUTH_LIMIT = 300;

/**
 * Redis-backed sliding window rate limiter.
 * - Unauthenticated: 100 req/min per IP
 * - Authenticated: 300 req/min per userId
 * Adds X-RateLimit-* headers on every response.
 */
export async function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.id;
  const key = userId ? `rl:user:${userId}` : `rl:ip:${req.ip}`;
  const limit = userId ? AUTH_LIMIT : UNAUTH_LIMIT;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const resetAt = Math.ceil((now + WINDOW_MS) / 1000);

  const setHeaders = (remaining: number) => {
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetAt);
  };

  try {
    const redis = getRedis();
    const member = `${now}:${Math.random()}`;

    await redis.zadd(key, now, member);
    await redis.zremrangebyscore(key, '-inf', windowStart);
    await redis.expire(key, Math.ceil(WINDOW_MS / 1000) + 1);
    const count = await redis.zcard(key);

    const remaining = Math.max(0, limit - count);
    setHeaders(remaining);

    if (count > limit) {
      res.setHeader('Retry-After', Math.ceil(WINDOW_MS / 1000));
      res.status(429).json({ message: 'Too many requests' });
      return;
    }

    next();
  } catch {
    // Fail open on Redis errors
    setHeaders(limit);
    next();
  }
}
