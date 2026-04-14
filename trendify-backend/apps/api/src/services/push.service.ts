import * as https from 'https';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { TrendItem } from '../types/trend';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

const RETRIABLE_ERRORS = new Set(['MessageTooBig', 'MessageRateExceeded']);

/**
 * Upsert a push token for a user. If the token already exists for another user,
 * it is reassigned. If it already belongs to this user, it is a no-op.
 */
export async function registerToken(userId: string, token: string): Promise<void> {
  await prisma.pushToken.upsert({
    where: { token },
    create: { userId, token },
    update: { userId },
  });
}

/**
 * Send push notifications to all users whose preferences include the
 * trendItem's category and who have at least one push token stored.
 */
export async function notifyNewTrendItem(trendItem: TrendItem): Promise<void> {
  // Find users with matching category preference and push tokens
  const usersWithTokens = await prisma.user.findMany({
    where: {
      preferences: {
        categories: {
          has: trendItem.category,
        },
      },
      pushTokens: {
        some: {},
      },
    },
    include: {
      pushTokens: true,
    },
  });

  // Collect all tokens
  const allTokens: string[] = usersWithTokens.flatMap((u) => u.pushTokens.map((pt) => pt.token));

  if (allTokens.length === 0) {
    return;
  }

  // Batch into groups of ≤ BATCH_SIZE
  const batches: string[][] = [];
  for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
    batches.push(allTokens.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const messages: ExpoPushMessage[] = batch.map((token) => ({
      to: token,
      title: 'New Trend',
      body: trendItem.title,
    }));

    await sendBatchWithRetry(messages, batch);
  }
}

/**
 * Send a batch of push messages with exponential backoff retry on retriable errors.
 * Removes tokens from DB on non-retriable errors.
 */
export async function sendBatchWithRetry(
  messages: ExpoPushMessage[],
  tokens: string[],
): Promise<void> {
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    let tickets: ExpoPushTicket[];
    try {
      const response = await callExpoApi(messages);
      tickets = response.data;
    } catch (err) {
      attempt++;
      if (attempt >= MAX_ATTEMPTS) {
        logger.error({ err, tokens }, 'Push notification batch failed after max attempts');
        return;
      }
      await sleep(100 * Math.pow(2, attempt));
      continue;
    }

    // Process per-ticket results
    const tokensToRemove: string[] = [];
    const retriableMessages: ExpoPushMessage[] = [];
    const retriableTokens: string[] = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error') {
        const errorCode = ticket.details?.error;
        if (errorCode && RETRIABLE_ERRORS.has(errorCode)) {
          retriableMessages.push(messages[i]);
          retriableTokens.push(tokens[i]);
        } else {
          // Non-retriable (e.g. DeviceNotRegistered) — remove token
          tokensToRemove.push(tokens[i]);
        }
      }
    }

    // Remove non-retriable tokens
    if (tokensToRemove.length > 0) {
      await prisma.pushToken.deleteMany({
        where: { token: { in: tokensToRemove } },
      });
    }

    if (retriableMessages.length === 0) {
      return;
    }

    // Retry only the retriable subset
    attempt++;
    if (attempt >= MAX_ATTEMPTS) {
      logger.error(
        { tokens: retriableTokens },
        'Push notification batch failed after max attempts (retriable errors)',
      );
      return;
    }

    await sleep(100 * Math.pow(2, attempt));
    messages = retriableMessages;
    tokens = retriableTokens;
  }
}

/**
 * POST messages to the Expo Push API and return the parsed response.
 */
export function callExpoApi(messages: ExpoPushMessage[]): Promise<ExpoPushResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(messages);
    const url = new URL(EXPO_PUSH_URL);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as ExpoPushResponse;
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse Expo API response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
