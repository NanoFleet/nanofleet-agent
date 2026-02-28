import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

const API_BASE = `http://localhost:${process.env.PORT || '4111'}/api/agents/main`;
// Fixed resourceId for the CLI user — all CLI sessions belong to the same "user"
const CLI_RESOURCE_ID = 'cli-user';

const rl = createInterface({ input, output });

function prompt(): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question('You: ', (answer) => {
      resolve(answer);
    });
    rl.once('close', () => resolve(null));
  });
}

interface UsageData {
  inputTokens?: number;
  outputTokens?: number;
}

interface SendMessageResult {
  text: string;
  threadId: string | null;
  usage: UsageData;
  cost: number | null;
}

async function createThread(): Promise<string> {
  const response = await fetch(`${API_BASE}/memory/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceId: CLI_RESOURCE_ID }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create thread: ${response.status} ${error}`);
  }

  const data = await response.json() as { thread: { id: string } };
  return data.thread.id;
}

async function sendMessage(message: string, threadId: string): Promise<SendMessageResult> {
  const body = {
    messages: [{ role: 'user', content: message }],
    threadId,
    resourceId: CLI_RESOURCE_ID,
  };

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<SendMessageResult>;
}

function formatUsage(usage: UsageData | null, cost: number | null, model: string): string {
  const inp = usage?.inputTokens ?? 0;
  const out = usage?.outputTokens ?? 0;
  const costStr = cost != null ? `$${cost.toFixed(4)}` : 'n/a';
  return `[tokens: ${inp} input + ${out} output | cost: ${costStr} | model: ${model}]`;
}

export async function startCLI(): Promise<void> {
  console.log('NanoFleet Agent CLI');
  console.log('Type your messages, or "exit" to quit.\n');

  const model = process.env.AGENT_MODEL || 'unknown';
  const threadId = await createThread();

  while (true) {
    try {
      const input_ = await prompt();

      // EOF (Ctrl+D) or readline closed
      if (input_ === null) {
        break;
      }

      const message = input_.trim();

      if (!message) {
        continue;
      }

      if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
        break;
      }

      console.log('');

      const result = await sendMessage(message, threadId);

      console.log(`Agent: ${result.text}\n`);
      console.log(formatUsage(result.usage, result.cost, model));
      console.log('');
    } catch (error) {
      console.error(`Error: ${error}\n`);
    }
  }

  rl.close();
  console.log('Goodbye!');
}
