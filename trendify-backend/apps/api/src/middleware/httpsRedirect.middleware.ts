import { Request, Response, NextFunction } from 'express';

/**
 * In production, redirect HTTP requests to HTTPS.
 * Checks the X-Forwarded-Proto header set by load balancers/proxies.
 */
export function httpsRedirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  const proto = req.headers['x-forwarded-proto'] as string | undefined;
  if (proto && proto !== 'https') {
    res.redirect(301, `https://${req.headers.host}${req.url}`);
    return;
  }
  next();
}
