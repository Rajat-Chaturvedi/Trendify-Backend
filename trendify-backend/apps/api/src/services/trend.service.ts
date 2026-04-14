import { Category, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet, cacheDel } from '../lib/redis';
import { NotFoundError } from '../errors/AppError';
import { FetchTrendParams, StrapiWebhookPayload, TrendItem, TrendItemPage } from '../types/trend';

const DEFAULT_PAGE_SIZE = 20;

function encodeCursor(publishedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ publishedAt: publishedAt.toISOString(), id })).toString('base64');
}

function decodeCursor(cursor: string): { publishedAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
}

function toTrendItem(item: {
  id: string;
  strapiId: string;
  title: string;
  description: string;
  source: string;
  publishedAt: Date;
  imageUrl: string | null;
  url: string;
  category: Category;
  regionCode: string | null;
  locale: string;
}): TrendItem {
  return {
    id: item.id,
    strapiId: item.strapiId,
    title: item.title,
    description: item.description,
    source: item.source,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    url: item.url,
    category: item.category,
    regionCode: item.regionCode,
    locale: item.locale,
  };
}

export async function listTrends(params: FetchTrendParams): Promise<TrendItemPage> {
  let { categories, regionCode, cursor, pageSize = DEFAULT_PAGE_SIZE, locale, userId } = params;

  // Load user preferences if userId provided and no explicit filters
  if (userId && !categories && !regionCode && !locale) {
    const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
    if (prefs) {
      if (prefs.categories.length > 0) categories = prefs.categories;
      if (prefs.regionCode) regionCode = prefs.regionCode;
      if (prefs.locale) locale = prefs.locale;
    }
  }

  const where: Prisma.TrendItemWhereInput = { published: true };

  if (categories && categories.length > 0) {
    where.category = { in: categories };
  }

  if (regionCode) {
    where.OR = [{ regionCode }, { regionCode: null }];
  }

  if (locale) {
    where.locale = locale;
  }

  // Apply cursor-based keyset pagination
  if (cursor) {
    const decoded = decodeCursor(cursor);
    const cursorWhere: Prisma.TrendItemWhereInput = {
      OR: [
        { publishedAt: { lt: new Date(decoded.publishedAt) } },
        { publishedAt: new Date(decoded.publishedAt), id: { lt: decoded.id } },
      ],
    };

    // Merge cursor condition with existing where
    if (where.OR) {
      // Already have an OR (regionCode filter) — wrap both in AND
      where.AND = [{ OR: where.OR }, cursorWhere];
      delete where.OR;
    } else {
      where.OR = cursorWhere.OR;
    }
  }

  const limit = pageSize + 1;

  // Cache-aside: check Redis before querying Postgres (TTL 60s)
  const cacheKey = `trends:list:${createHash('md5').update(JSON.stringify({ categories, regionCode, cursor, pageSize, locale })).digest('hex')}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached) as TrendItemPage;

  const [rows, totalCount] = await Promise.all([
    prisma.trendItem.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    }),
    prisma.trendItem.count({ where }),
  ]);

  let nextCursor: string | null = null;
  if (rows.length === limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor(last.publishedAt, last.id);
  }

  const result: TrendItemPage = {
    items: rows.map(toTrendItem),
    nextCursor,
    totalCount,
  };

  await cacheSet(cacheKey, JSON.stringify(result), 60);
  return result;
}

export async function getTrendById(id: string, locale: string): Promise<TrendItem> {
  const cacheKey = `trends:item:${id}:${locale}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached) as TrendItem;

  let item = await prisma.trendItem.findFirst({ where: { id, locale } });

  if (!item && locale !== 'en') {
    item = await prisma.trendItem.findFirst({ where: { id, locale: 'en' } });
  }

  if (!item) {
    throw new NotFoundError(`Trend item not found: ${id}`);
  }

  const result = toTrendItem(item);
  await cacheSet(cacheKey, JSON.stringify(result), 300);
  return result;
}

export async function upsertFromWebhook(payload: StrapiWebhookPayload): Promise<TrendItem> {
  const { event, entry } = payload;
  const strapiId = String(entry.id);
  const published = !event.includes('unpublish');

  const data = {
    title: entry.title,
    description: entry.description,
    source: entry.source,
    publishedAt: new Date(entry.publishedAt),
    imageUrl: entry.imageUrl ?? null,
    url: entry.url,
    category: entry.category as Category,
    regionCode: entry.regionCode ?? null,
    locale: entry.locale ?? 'en',
    published,
  };

  const item = await prisma.trendItem.upsert({
    where: { strapiId },
    create: { strapiId, ...data },
    update: data,
  });

  // Invalidate caches for this item and matching category lists
  await cacheDel(`trends:item:${item.id}:*`);
  await cacheDel(`trends:list:*`);

  return toTrendItem(item);
}
