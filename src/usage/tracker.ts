import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { calculateCost } from './prices.js';

export interface UsageRecord {
  id: number;
  agentId: string;
  threadId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number | null;
  timestamp: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number | null;
  cacheHitRate: number | null;
  requests: number;
}

let _db: ReturnType<typeof createClient> | null = null;

function getUsageDb() {
  if (!_db) {
    const dbPath = process.env.MEMORY_DB_PATH || '/workspace/.db/agent.db';
    mkdirSync(dirname(dbPath), { recursive: true });
    _db = createClient({ url: `file:${dbPath}` });
  }
  return _db;
}

export async function initUsageTable(): Promise<void> {
  const db = getUsageDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      thread_id TEXT,
      model_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage(agent_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_usage_thread ON usage(thread_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp)
  `);
}

export async function recordUsage(
  agentId: string,
  threadId: string | null,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): Promise<void> {
  const db = getUsageDb();
  const totalTokens = inputTokens + outputTokens;
  const cost = calculateCost(modelId, inputTokens, outputTokens);

  await db.execute({
    sql: `INSERT INTO usage (agent_id, thread_id, model_id, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_write_tokens, cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [agentId, threadId, modelId, inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, cost],
  });
}

export async function getAgentUsage(agentId: string): Promise<UsageSummary> {
  const db = getUsageDb();

  const result = await db.execute({
    sql: `SELECT 
            COALESCE(SUM(prompt_tokens), 0) as total_prompt,
            COALESCE(SUM(completion_tokens), 0) as total_completion,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as cache_read,
            COALESCE(SUM(cache_write_tokens), 0) as cache_write,
            COALESCE(SUM(cost), 0) as total_cost,
            COUNT(*) as requests
          FROM usage WHERE agent_id = ?`,
    args: [agentId],
  });

  const row = result.rows?.[0] as Record<string, number> | undefined;

  if (!row) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: null,
      cacheHitRate: null,
      requests: 0,
    };
  }

  const cacheHitRate =
    row.total_prompt > 0
      ? (row.cache_read / row.total_prompt) * 100
      : null;

  return {
    totalInputTokens: row.total_prompt ?? 0,
    totalOutputTokens: row.total_completion ?? 0,
    totalTokens: row.total_tokens ?? 0,
    totalCacheReadTokens: row.cache_read ?? 0,
    totalCacheWriteTokens: row.cache_write ?? 0,
    totalCost: row.total_cost != null && row.total_cost > 0 ? row.total_cost : null,
    cacheHitRate,
    requests: row.requests ?? 0,
  };
}

export async function getThreadUsage(agentId: string, threadId: string): Promise<UsageSummary> {
  const db = getUsageDb();

  const result = await db.execute({
    sql: `SELECT 
            COALESCE(SUM(prompt_tokens), 0) as total_prompt,
            COALESCE(SUM(completion_tokens), 0) as total_completion,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as cache_read,
            COALESCE(SUM(cache_write_tokens), 0) as cache_write,
            COALESCE(SUM(cost), 0) as total_cost,
            COUNT(*) as requests
          FROM usage WHERE agent_id = ? AND thread_id = ?`,
    args: [agentId, threadId],
  });

  const row = result.rows?.[0] as Record<string, number> | undefined;

  if (!row) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: null,
      cacheHitRate: null,
      requests: 0,
    };
  }

  const cacheHitRate =
    row.total_prompt > 0
      ? (row.cache_read / row.total_prompt) * 100
      : null;

  return {
    totalInputTokens: row.total_prompt ?? 0,
    totalOutputTokens: row.total_completion ?? 0,
    totalTokens: row.total_tokens ?? 0,
    totalCacheReadTokens: row.cache_read ?? 0,
    totalCacheWriteTokens: row.cache_write ?? 0,
    totalCost: row.total_cost != null && row.total_cost > 0 ? row.total_cost : null,
    cacheHitRate,
    requests: row.requests ?? 0,
  };
}
