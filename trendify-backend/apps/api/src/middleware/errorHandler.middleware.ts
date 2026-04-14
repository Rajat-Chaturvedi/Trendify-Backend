import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError } from '../errors/AppError';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  // Known application errors
  if (err instanceof AppError) {
    return void res.status(err.statusCode).json({ message: err.message });
  }

  // Zod validation errors (if not caught in route handlers)
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
    return void res.status(400).json({ message: 'Validation error', errors });
  }

  // Prisma known request errors (e.g. unique constraint violations)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return void res.status(409).json({ message: 'Resource already exists' });
    }
    if (err.code === 'P2025') {
      return void res.status(404).json({ message: 'Resource not found' });
    }
  }

  // Unhandled — log server-side, never expose internals to client
  logger.error({
    message: err.message,
    stack: err.stack,
    correlationId: req.correlationId,
  });

  res.status(500).json({ message: 'Internal server error' });
}
