import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { httpRequestCount, httpRequestDuration } from '../utils/metrics';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.startTime = Date.now();

  res.on('finish', () => {
    const responseTimeMs = Date.now() - (req.startTime ?? Date.now());
    logger.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTimeMs,
      correlationId: req.correlationId,
    });

    const labels = { method: req.method, path: req.path, status: String(res.statusCode) };
    httpRequestCount.inc(labels);
    httpRequestDuration.observe(labels, responseTimeMs);
  });

  next();
}
