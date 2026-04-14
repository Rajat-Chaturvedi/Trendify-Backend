import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ConflictError, UnauthorizedError, ValidationError } from '../errors/AppError';
import type { AuthTokenPair, JwtPayload } from '../types/auth';

const BCRYPT_COST = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getPrivateKey(): string {
  return env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
}

function getPublicKey(): string {
  return env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
}

function issueAccessToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

async function createRefreshToken(userId: string): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });

  return token;
}

export async function register(email: string, password: string): Promise<AuthTokenPair> {
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  const accessToken = issueAccessToken(user.id, user.email);
  const refreshToken = await createRefreshToken(user.id);

  return { accessToken, refreshToken };
}

export async function login(email: string, password: string): Promise<AuthTokenPair> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const accessToken = issueAccessToken(user.id, user.email);
  const refreshToken = await createRefreshToken(user.id);

  return { accessToken, refreshToken };
}

export async function refresh(refreshToken: string): Promise<AuthTokenPair> {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored || stored.revokedAt !== null || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = issueAccessToken(stored.user.id, stored.user.email);
  const newRefreshToken = await createRefreshToken(stored.user.id);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    return payload as JwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export async function revokeAllTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
