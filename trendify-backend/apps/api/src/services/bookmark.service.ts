import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError } from '../errors/AppError';
import { TrendItem, TrendItemPage } from '../types/trend';

const DEFAULT_PAGE_SIZE = 20;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
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
  category: import('@prisma/client').Category;
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

export async function addBookmark(userId: string, trendItemId: string): Promise<void> {
  try {
    await prisma.bookmark.create({
      data: { userId, trendItemId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Already bookmarked');
    }
    throw err;
  }
}

export async function removeBookmark(userId: string, trendItemId: string): Promise<void> {
  try {
    await prisma.bookmark.delete({
      where: { userId_trendItemId: { userId, trendItemId } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new NotFoundError('Bookmark not found');
    }
    throw err;
  }
}

export async function listBookmarks(
  userId: string,
  cursor?: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<TrendItemPage> {
  const where: Prisma.BookmarkWhereInput = { userId };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    where.OR = [
      { createdAt: { lt: new Date(decoded.createdAt) } },
      { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
    ];
  }

  const limit = pageSize + 1;

  const bookmarks = await prisma.bookmark.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { trendItem: true },
  });

  let nextCursor: string | null = null;
  if (bookmarks.length === limit) {
    bookmarks.pop();
    const last = bookmarks[bookmarks.length - 1];
    nextCursor = encodeCursor(last.createdAt, last.id);
  }

  const totalCount = await prisma.bookmark.count({ where: { userId } });

  return {
    items: bookmarks.map((b) => toTrendItem(b.trendItem)),
    nextCursor,
    totalCount,
  };
}
