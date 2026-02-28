import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from '@mastra/core/agent';
import { notificationEmitter } from '../notifications/emitter';

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL || '1800') * 1000;

function getHeartbeatPath(): string {
  const workspace = process.env.AGENT_WORKSPACE;
  if (!workspace) {
    throw new Error('AGENT_WORKSPACE environment variable is required');
  }
  return join(workspace, 'HEARTBEAT.md');
}

function hasActionableItems(content: string): boolean {
  // Look for unchecked checklist items: "- [ ]"
  return /- \[ \]/.test(content);
}

async function runHeartbeat(agent: Agent): Promise<void> {
  const heartbeatPath = getHeartbeatPath();

  console.log('[heartbeat] tick');

  if (!existsSync(heartbeatPath)) {
    console.log('[heartbeat] skipped — HEARTBEAT.md not found');
    return;
  }

  const content = await readFile(heartbeatPath, 'utf-8');

  if (!content.trim() || !hasActionableItems(content)) {
    console.log('[heartbeat] skipped — no actionable items');
    return;
  }

  const prompt = `You are running a scheduled heartbeat check. Here is your HEARTBEAT.md:\n\n${content}\n\nProcess any unchecked tasks (- [ ]) above. When done, respond with HEARTBEAT_OK.`;

  console.log('[heartbeat] running...');

  try {
    const result = await agent.generate([{ role: 'user', content: prompt }], {
      memory: { thread: 'heartbeat:main', resource: 'heartbeat' },
    });

    const text = result.text ?? '';
    if (text.startsWith('HEARTBEAT_OK')) {
      console.log('[heartbeat] OK');
    } else {
      console.log('[heartbeat] processed — emitting notification');
      notificationEmitter.notify(text);
    }
  } catch (error) {
    console.error('[heartbeat] Error during heartbeat run:', error);
  }
}

export function startHeartbeat(agent: Agent): void {
  console.log(`[heartbeat] Starting with interval ${HEARTBEAT_INTERVAL_MS / 1000}s`);

  setInterval(() => {
    runHeartbeat(agent).catch((error) => {
      console.error('[heartbeat] Unexpected error:', error);
    });
  }, HEARTBEAT_INTERVAL_MS);
}
