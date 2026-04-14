import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { cacheDel } from '../lib/redis';
import { authMiddleware } from '../middleware/auth.middleware';
import { isValidBcp47 } from '../services/i18n.service';
import { NotFoundError } from '../errors/AppError';
import { Category } from '@prisma/client';
import { sanitizeString } from '../utils/sanitize';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

const VALID_CATEGORIES = Object.values(Category);

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100),
});

const preferencesSchema = z.object({
  categories: z.array(z.nativeEnum(Category)),
  regionCode: z.string().nullable().optional(),
  locale: z.string(),
});

const pushTokenSchema = z.object({
  token: z.string().min(1),
});

// Max ~2MB base64 string (~1.5MB image)
const MAX_BASE64_SIZE = 2 * 1024 * 1024;

const avatarSchema = z.object({
  avatar: z
    .string()
    .min(1, 'avatar is required')
    .refine(
      (v) => v.startsWith('data:image/'),
      'avatar must be a base64 data URI starting with data:image/',
    )
    .refine(
      (v) => Buffer.byteLength(v, 'utf8') <= MAX_BASE64_SIZE,
      'Image too large — maximum size is ~1.5 MB',
    ),
});

// GET /api/v1/users/me
router.get('/me', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, avatar: true, createdAt: true },
    });
    if (!user) return next(new NotFoundError('User not found'));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me
router.patch('/me', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = updateProfileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { displayName: sanitizeString(body.displayName) },
      select: { id: true, email: true, displayName: true, avatar: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

// GET /api/v1/users/me/preferences
router.get('/me/preferences', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId },
      select: { categories: true, regionCode: true, locale: true },
    });
    if (!prefs) {
      return res.json({ categories: [], regionCode: null, locale: 'en' });
    }
    res.json(prefs);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/users/me/preferences
router.put('/me/preferences', async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Validate categories manually before Zod to give a clear error
    const rawCategories: unknown[] = Array.isArray(req.body?.categories) ? req.body.categories : [];
    for (const cat of rawCategories) {
      if (!VALID_CATEGORIES.includes(cat as Category)) {
        return res.status(400).json({
          message: 'Validation error',
          errors: [{ field: 'categories', message: `Invalid category value: ${cat}` }],
        });
      }
    }

    const body = preferencesSchema.parse(req.body);

    if (!isValidBcp47(body.locale)) {
      return res.status(400).json({
        message: 'Validation error',
        errors: [{ field: 'locale', message: 'locale must be a valid BCP 47 language tag' }],
      });
    }

    const prefs = await prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        categories: body.categories,
        regionCode: body.regionCode ?? null,
        locale: body.locale,
      },
      update: {
        categories: body.categories,
        regionCode: body.regionCode ?? null,
        locale: body.locale,
      },
      select: { categories: true, regionCode: true, locale: true },
    });

    // Invalidate Redis cache
    await cacheDel(`user:prefs:${userId}`);

    res.json(prefs);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

// POST /api/v1/users/me/avatar
router.post('/me/avatar', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = avatarSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: body.avatar },
      select: { id: true, email: true, displayName: true, avatar: true, createdAt: true },
    });

    res.json({ message: 'Avatar updated', avatarUrl: user.avatar });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

// DELETE /api/v1/users/me/avatar
router.delete('/me/avatar', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    await prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/push-token
router.post('/me/push-token', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = pushTokenSchema.parse(req.body);

    await prisma.pushToken.upsert({
      where: { token: body.token },
      create: { userId, token: body.token },
      update: { userId },
    });

    res.status(201).json({ message: 'Push token registered' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

export default router;
