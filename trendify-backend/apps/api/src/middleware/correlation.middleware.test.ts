import * as fc from 'fast-check';
import { correlationMiddleware } from './correlation.middleware';

// Feature: trendify-backend-cms, Property 30: Correlation ID propagation
describe('correlationMiddleware', () => {
  it('Property 30: propagates existing X-Correlation-ID header unchanged', () => {
    fc.assert(
      fc.property(fc.uuid(), (correlationId) => {
        const req = { headers: { 'x-correlation-id': correlationId }, correlationId: '' } as any;
        const headers: Record<string, string> = {};
        const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
        const next = jest.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBe(correlationId);
        expect(headers['X-Correlation-ID']).toBe(correlationId);
        expect(next).toHaveBeenCalled();
      }),
      { numRuns: 20 }
    );
  });

  it('Property 30: generates a non-empty UUID when X-Correlation-ID header is absent', () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        const req = { headers: {}, correlationId: '' } as any;
        const headers: Record<string, string> = {};
        const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
        const next = jest.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBeTruthy();
        expect(req.correlationId.length).toBeGreaterThan(0);
        expect(headers['X-Correlation-ID']).toBe(req.correlationId);
        expect(next).toHaveBeenCalled();
      }),
      { numRuns: 20 }
    );
  });
});
