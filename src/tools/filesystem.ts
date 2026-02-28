import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

function getWorkspacePath(): string {
  const workspace = process.env.AGENT_WORKSPACE;
  if (!workspace) {
    throw new Error('AGENT_WORKSPACE environment variable is required');
  }
  return workspace;
}

function safePath(filepath: string): string {
  const workspace = getWorkspacePath();
  const resolved = join(workspace, filepath);

  if (!resolved.startsWith(workspace)) {
    throw new Error('Path traversal detected');
  }

  return resolved;
}

export const readFileTool = createTool({
  id: 'read-file',
  description: 'Read a file from the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file from workspace root'),
  }),
  execute: async ({ path }) => {
    const fullPath = safePath(path);
    const content = await readFile(fullPath, 'utf-8');
    return { path, content };
  },
});

export const writeFileTool = createTool({
  id: 'write-file',
  description: 'Write or create a file in the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file from workspace root'),
    content: z.string().describe('Content to write to the file'),
  }),
  execute: async ({ path, content }) => {
    const fullPath = safePath(path);

    await writeFile(fullPath, content, 'utf-8');

    return { path, success: true };
  },
});

export const editFileTool = createTool({
  id: 'edit-file',
  description: 'Edit a file with precise string replacement. Use for making targeted changes to existing files.',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file from workspace root'),
    oldString: z.string().describe('The exact string to replace'),
    newString: z.string().describe('The replacement string'),
  }),
  execute: async ({ path, oldString, newString }) => {
    const fullPath = safePath(path);
    const content = await readFile(fullPath, 'utf-8');

    if (!content.includes(oldString)) {
      return {
        path,
        success: false,
        error: 'String not found in file',
      };
    }

    const newContent = content.replace(oldString, newString);
    await writeFile(fullPath, newContent, 'utf-8');

    return { path, success: true };
  },
});

export const listDirTool = createTool({
  id: 'list-dir',
  description: 'List directory contents',
  inputSchema: z.object({
    path: z.string().describe('Relative path to directory from workspace root').optional(),
    recursive: z.boolean().describe('List recursively').optional(),
  }),
  execute: async ({ path = '', recursive = false }) => {
    const workspace = getWorkspacePath();
    const fullPath = join(workspace, path);

    async function walk(dir: string, relPath: string): Promise<Array<{ path: string; type: 'file' | 'directory' }>> {
      const entries = await readdir(dir);
      const results: Array<{ path: string; type: 'file' | 'directory' }> = [];

      for (const entry of entries) {
        const entryPath = join(dir, entry);
        const entryRelPath = join(relPath, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          results.push({ path: entryRelPath, type: 'directory' });
          if (recursive) {
            const subResults = await walk(entryPath, entryRelPath);
            results.push(...subResults);
          }
        } else {
          results.push({ path: entryRelPath, type: 'file' });
        }
      }

      return results;
    }

    const results = await walk(fullPath, path || '.');

    return { path: path || '.', entries: results };
  },
});
