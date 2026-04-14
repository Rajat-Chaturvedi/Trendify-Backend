import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { runMigrations } from './utils/migrate';
import { logger } from './utils/logger';

async function main() {
  // 1. Apply pending migrations before accepting requests
  await runMigrations();

  // 2. Create Express app
  const app = createApp();

  // 3. Create HTTP server
  const server = http.createServer(app);

  // 4. Bind port
  server.listen(env.PORT, () => {
    logger.info({ message: `Server listening on port ${env.PORT}`, port: env.PORT });
  });

  // 5. Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
