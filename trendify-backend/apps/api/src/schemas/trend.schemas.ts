import { z } from 'zod';
import { Category } from '@prisma/client';

export const listTrendsQuerySchema = z.object({
  categories: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').map((s) => s.trim()) as Category[]) : undefined)),
  regionCode: z.string().optional(),
  cursor: z.string().optional(),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 20))
    .refine((v) => v >= 1 && v <= 100, { message: 'pageSize must be between 1 and 100' }),
  locale: z.string().optional(),
});

export const getTrendParamsSchema = z.object({
  id: z.string().uuid(),
});
