import { Router } from 'express';
import { z } from 'zod';
import * as trendService from '../services/trend.service';
import { listTrendsQuerySchema, getTrendParamsSchema } from '../schemas/trend.schemas';
import { AppError } from '../errors/AppError';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const query = listTrendsQuerySchema.parse(req.query);
    const locale = req.locale ?? 'en';
    const userId = req.user?.id;

    const page = await trendService.listTrends({
      categories: query.categories,
      regionCode: query.regionCode,
      cursor: query.cursor,
      pageSize: query.pageSize,
      locale: query.locale ?? locale,
      userId,
    });

    res.setHeader('Content-Language', locale);
    res.json(page);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = getTrendParamsSchema.parse(req.params);
    const locale = req.locale ?? 'en';

    const item = await trendService.getTrendById(id, locale);

    res.setHeader('Content-Language', item.locale);
    res.json(item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

export default router;
