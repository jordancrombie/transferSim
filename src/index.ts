import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma } from './lib/prisma.js';

async function main() {
  const app = createApp();

  // Test database connection
  try {
    await prisma.$connect();
    console.log('Connected to database');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Start server
  app.listen(config.port, () => {
    console.log(`TransferSim server running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Health check: http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
