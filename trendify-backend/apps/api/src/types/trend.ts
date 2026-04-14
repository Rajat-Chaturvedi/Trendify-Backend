import { Category } from '@prisma/client';

export interface TrendItem {
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
}

export interface TrendItemPage {
  items: TrendItem[];
  nextCursor: string | null;
  totalCount: number;
}

export interface FetchTrendParams {
  categories?: Category[];
  regionCode?: string;
  cursor?: string;
  pageSize?: number;
  locale?: string;
  userId?: string; // for applying stored preferences
}

export interface StrapiWebhookPayload {
  event: string;
  model: string;
  entry: {
    id: number;
    title: string;
    description: string;
    source: string;
    publishedAt: string;
    imageUrl?: string;
    url: string;
    category: string;
    regionCode?: string;
    locale?: string;
  };
}
