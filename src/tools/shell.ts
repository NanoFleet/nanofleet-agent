import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function isShellEnabled(): boolean {
  return process.env.SHELL_TOOL_ENABLED === 'true';
}

function getDenyPatterns(): string[] {
  const patterns = process.env.SHELL_DENY_PATTERNS;
  if (!patterns) {
    return [];
  }
  return patterns.split(',').map((p) => p.trim());
}

function checkDenyPatterns(command: string, denyPatterns: string[]): string | null {
  for (const pattern of denyPatterns) {
    if (command.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

function isRunningInDocker(): boolean {
  try {
    const cgroup = require('node:fs').readFileSync('/proc/1/cgroup', 'utf-8');
    return cgroup.includes('docker') || cgroup.includes('containerd');
  } catch {
    return false;
  }
}

export const execShellTool = createTool({
  id: 'exec-shell',
  description: 'Execute a shell command. Only available when SHELL_TOOL_ENABLED=true and running in Docker.',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async ({ command }) => {
    if (!isShellEnabled()) {
      return {
        success: false,
        error: 'Shell tool is disabled. Set SHELL_TOOL_ENABLED=true to enable.',
      };
    }

    const inDocker = isRunningInDocker();
    if (!inDocker) {
      return {
        success: false,
        error: 'Shell tool is only available when running in Docker',
      };
    }

    const denyPatterns = getDenyPatterns();
    const deniedPattern = checkDenyPatterns(command, denyPatterns);
    if (deniedPattern) {
      return {
        success: false,
        error: `Command denied: contains blocked pattern "${deniedPattern}"`,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        stdout,
        stderr,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});
