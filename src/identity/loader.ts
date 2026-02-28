import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CORE_INSTRUCTIONS = `You are a helpful AI assistant. Always be helpful, concise, and accurate in your responses.`;

export interface IdentityFiles {
  soul: string;
  style?: string;
  memory?: string;
  agents?: string;
  history?: string;
  heartbeat?: string;
}

export interface SystemPromptParts {
  core: string;
  soul: string;
  style?: string;
  memory?: string;
  skills: string;
  agents?: string;
}

function getWorkspacePath(): string {
  const workspace = process.env.AGENT_WORKSPACE;
  if (!workspace) {
    throw new Error('AGENT_WORKSPACE environment variable is required');
  }
  return workspace;
}

function readMarkdownFile(filename: string): Promise<string | undefined> {
  const workspace = getWorkspacePath();
  const filepath = join(workspace, filename);
  return readFile(filepath, 'utf-8').catch(() => undefined);
}

export async function loadIdentityFiles(): Promise<IdentityFiles> {
  const [soul, style, memory, agents, history, heartbeat] = await Promise.all([
    readMarkdownFile('SOUL.md'),
    readMarkdownFile('STYLE.md'),
    readMarkdownFile('MEMORY.md'),
    readMarkdownFile('AGENTS.md'),
    readMarkdownFile('HISTORY.md'),
    readMarkdownFile('HEARTBEAT.md'),
  ]);

  if (soul === undefined) {
    throw new Error('SOUL.md is required in workspace');
  }

  return { soul, style, memory, agents, history, heartbeat };
}

function truncateToLines(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(0, maxLines).join('\n');
}

export async function assembleSystemPrompt(): Promise<string> {
  const identity = await loadIdentityFiles();

  const parts: SystemPromptParts = {
    core: CORE_INSTRUCTIONS,
    soul: identity.soul,
    style: identity.style,
    memory: identity.memory ? truncateToLines(identity.memory, 200) : undefined,
    skills: '',
    agents: identity.agents,
  };

  const promptParts: string[] = [parts.core, '', parts.soul];

  if (parts.style) {
    promptParts.push('', parts.style);
  }

  if (parts.memory) {
    promptParts.push('', '## Long-term Memory', parts.memory);
  }

  if (parts.skills) {
    promptParts.push('', '## Available Skills', parts.skills);
  }

  if (parts.agents) {
    promptParts.push('', '## Other Agents', parts.agents);
  }

  return promptParts.join('\n');
}

export async function getIdentitySummary(): Promise<{
  hasSoul: boolean;
  hasStyle: boolean;
  hasMemory: boolean;
  hasAgents: boolean;
  hasHistory: boolean;
  hasHeartbeat: boolean;
}> {
  const identity = await loadIdentityFiles();

  return {
    hasSoul: true,
    hasStyle: !!identity.style,
    hasMemory: !!identity.memory,
    hasAgents: !!identity.agents,
    hasHistory: !!identity.history,
    hasHeartbeat: !!identity.heartbeat,
  };
}

export function generateDynamicReminders(): string {
  const now = new Date();
  const timeString = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `<system-reminder>
- Current time: ${timeString}
- Always consider the current time when planning tasks or scheduling.
</system-reminder>`;
}
