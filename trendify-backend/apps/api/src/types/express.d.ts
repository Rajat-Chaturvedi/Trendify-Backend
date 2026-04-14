declare namespace Express {
  interface Request {
    correlationId: string;
    startTime?: number;
    user?: { id: string; email: string };
    locale: string;
    userLocale?: string;
  }
}
