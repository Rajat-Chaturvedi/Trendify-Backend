import { Request, Response, NextFunction } from 'express';
import { resolveLocale } from '../services/i18n.service';

export function i18nMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.locale = resolveLocale(req);
  next();
}
