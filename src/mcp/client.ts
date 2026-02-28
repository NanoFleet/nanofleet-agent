import { MCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MCPConfig {
  mcpServers?: Record<string, MCPServerConfig>;
}

function getMcpConfigPath(): string {
  if (process.env.MCP_CONFIG_PATH) return process.env.MCP_CONFIG_PATH;
  const workspace = process.env.AGENT_WORKSPACE;
  if (workspace) return join(workspace, '.mcp.json');
  return '.mcp.json';
}

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || '');
}

function resolveEnvVars(env: Record<string, string> = {}): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = interpolateEnv(value);
  }
  return resolved;
}

export async function createMCPClient(): Promise<InstanceType<typeof MCPClient> | null> {
  const configPath = getMcpConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  const content = await readFile(configPath, 'utf-8');
  const config: MCPConfig = JSON.parse(content);

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    return null;
  }

  const servers: Record<string, MastraMCPServerDefinition> = {};

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if (serverConfig.url) {
      servers[name] = {
        url: new URL(interpolateEnv(serverConfig.url)),
      };
    } else if (serverConfig.command) {
      servers[name] = {
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: resolveEnvVars(serverConfig.env),
      };
    }
  }

  if (Object.keys(servers).length === 0) {
    return null;
  }

  const mcp = new MCPClient({
    servers,
    timeout: 60000,
  });

  return mcp;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMCPTools(): Promise<Record<string, any> | null> {
  const mcp = await createMCPClient();

  if (!mcp) {
    return null;
  }

  try {
    const tools = await mcp.listTools();
    return tools;
  } catch (error) {
    console.error('Failed to load MCP tools:', error);
    return null;
  }
}
