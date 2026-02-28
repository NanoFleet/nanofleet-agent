import { mastra, server } from './mastra';
import { startCLI } from './channels/cli';

const PORT = parseInt(process.env.PORT || '4111');
const app = server.getApp<any>();
const isCLI = process.argv.includes('--cli');

if (isCLI) {
  console.log('Starting server for CLI...');

  const serverInstance = Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });

  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');

  await startCLI();

  serverInstance.stop();
  process.exit(0);
}

console.log(`Starting nanofleet-agent on port ${PORT}...`);
console.log(`Health check: http://localhost:${PORT}/health`);
console.log(`API agents: http://localhost:${PORT}/api/agents`);

export default {
  port: PORT,
  fetch: app.fetch,
};
