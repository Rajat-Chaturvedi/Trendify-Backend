import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env';
import { correlationMiddleware } from './middleware/correlation.middleware';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware';
import { errorHandler } from './middleware/errorHandler.middleware';
import { rateLimiterMiddleware } from './middleware/rateLimiter.middleware';
import { i18nMiddleware } from './middleware/i18n.middleware';
import { httpsRedirectMiddleware } from './middleware/httpsRedirect.middleware';
import { register } from './utils/metrics';
import authRouter from './routes/auth.router';
import trendsRouter from './routes/trends.router';
import usersRouter from './routes/users.router';
import bookmarksRouter from './routes/bookmarks.router';
import webhooksRouter from './routes/webhooks.router';
import { liveness, readiness } from './services/health.service';

export function createApp(): Application {
  const app = express();

  // 1. HTTPS redirect (production only)
  app.use(httpsRedirectMiddleware);

  // 2. Security headers — HSTS, X-Content-Type-Options, X-Frame-Options
  app.use(
    helmet({
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: false, // configured separately if needed
    }),
  );

  // 2. CORS — restrict to ALLOWED_ORIGINS
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );

  // 3. Body parser
  app.use(express.json());

  // 4. Correlation ID — attach/propagate X-Correlation-ID
  app.use(correlationMiddleware);

  // 5. Request logger
  app.use(requestLoggerMiddleware);

  // 6. Rate limiter — Redis-backed sliding window
  app.use(rateLimiterMiddleware);

  // 7. i18n — resolve locale and attach to req
  app.use(i18nMiddleware);

  // 8. Routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/trends', trendsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/bookmarks', bookmarksRouter);
  app.use('/webhooks', webhooksRouter);

  // Health checks
  app.get('/health/live', (_req, res) => res.json(liveness()));
  app.get('/health/ready', async (_req, res) => {
    const result = await readiness();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  });
  app.use('/api/v1/bookmarks', bookmarksRouter);

  // 8. Metrics endpoint
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // 9. Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
