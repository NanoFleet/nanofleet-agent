import { webFetch } from './web';
import { readFileTool, writeFileTool, editFileTool, listDirTool } from './filesystem';
import { execShellTool } from './shell';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEnabledTools(): Record<string, any> {
  const enabledTools: Record<string, any> = {
    webFetch,
    readFile: readFileTool,
    writeFile: writeFileTool,
    editFile: editFileTool,
    listDir: listDirTool,
  };

  if (process.env.SHELL_TOOL_ENABLED === 'true') {
    enabledTools.execShell = execShellTool;
  }

  return enabledTools;
}
