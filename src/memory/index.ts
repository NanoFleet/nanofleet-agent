import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function getMemoryDbPath(): string {
  const path = process.env.MEMORY_DB_PATH;
  if (!path) {
    throw new Error('MEMORY_DB_PATH environment variable is required');
  }
  return path;
}

function getLastMessages(): number {
  const value = process.env.MEMORY_LAST_MESSAGES;
  if (!value) {
    return 20;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    throw new Error('MEMORY_LAST_MESSAGES must be a positive integer');
  }
  return parsed;
}

function getConsolidationThreshold(): number {
  const value = process.env.MEMORY_CONSOLIDATION_THRESHOLD;
  if (!value) {
    return 85;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    throw new Error('MEMORY_CONSOLIDATION_THRESHOLD must be a positive integer');
  }
  return parsed;
}

export const memoryConfig = {
  lastMessages: getLastMessages(),
  consolidationThreshold: getConsolidationThreshold(),
};

export function createMemory(storage: LibSQLStore): Memory {
  const memory = new Memory({
    storage,
    options: {
      lastMessages: memoryConfig.lastMessages,
      workingMemory: {
        enabled: true,
        template: `
# User Context
- Name: {{userName}}
- Preferences: {{preferences}}
- Ongoing Projects: {{ongoingProjects}}
`.trim(),
      },
    },
  });

  return memory;
}

export function createStorage(): LibSQLStore {
  const dbPath = getMemoryDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  return new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${dbPath}`,
  });
}
