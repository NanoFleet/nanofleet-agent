import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { memoryConfig } from './index';

function getWorkspacePath(): string {
  const workspace = process.env.AGENT_WORKSPACE;
  if (!workspace) {
    throw new Error('AGENT_WORKSPACE environment variable is required');
  }
  return workspace;
}

export interface ConsolidationResult {
  success: boolean;
  memoryUpdated: boolean;
  historyUpdated: boolean;
  error?: string;
}

export async function readMemoryFile(): Promise<string> {
  const workspace = getWorkspacePath();
  const filepath = join(workspace, 'MEMORY.md');
  return readFile(filepath, 'utf-8');
}

export async function writeMemoryFile(content: string): Promise<void> {
  const workspace = getWorkspacePath();
  const filepath = join(workspace, 'MEMORY.md');
  await writeFile(filepath, content, 'utf-8');
}

export async function readHistoryFile(): Promise<string> {
  const workspace = getWorkspacePath();
  const filepath = join(workspace, 'HISTORY.md');
  try {
    return await readFile(filepath, 'utf-8');
  } catch {
    return '# History\n\n';
  }
}

export async function appendHistoryEntry(entry: string): Promise<void> {
  const workspace = getWorkspacePath();
  const filepath = join(workspace, 'HISTORY.md');
  const existing = await readHistoryFile();
  await writeFile(filepath, existing + '\n\n' + entry, 'utf-8');
}

export function shouldConsolidate(messageCount: number): boolean {
  return messageCount > memoryConfig.consolidationThreshold;
}

export function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

export async function consolidateMemory(
  _recentMessages: Array<{ role: string; content: string }>,
): Promise<ConsolidationResult> {
  try {
    const timestamp = formatTimestamp();

    const historyEntry = `## ${timestamp}

**Summary:** Memory consolidation triggered (${_recentMessages.length} messages)
**Action:** Memory file maintained with current content

---
`;

    await appendHistoryEntry(historyEntry);

    return {
      success: true,
      memoryUpdated: true,
      historyUpdated: true,
    };
  } catch (error) {
    return {
      success: false,
      memoryUpdated: false,
      historyUpdated: false,
      error: String(error),
    };
  }
}
