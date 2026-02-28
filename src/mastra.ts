import { Mastra } from '@mastra/core/mastra';
import { MastraServer } from '@mastra/hono';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { version } from '../package.json';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { assembleSystemPrompt, getIdentitySummary, generateDynamicReminders } from './identity/loader';
import { createMemory, createStorage, memoryConfig } from './memory';
import { getEnabledTools } from './tools';
import { getMCPTools } from './mcp/client';
import { loadSkills, generateSkillsMetadataXml } from './skills/loader';
import { startHeartbeat } from './scheduling/heartbeat';
import { notificationEmitter, type Notification } from './notifications/emitter';
import { initUsageTable, recordUsage, getAgentUsage, getThreadUsage } from './usage/tracker';
import { calculateCost } from './usage/prices';

const PORT = parseInt(process.env.PORT || '4111');
const AGENT_MODEL = process.env.AGENT_MODEL;

if (!AGENT_MODEL) {
  throw new Error('AGENT_MODEL environment variable is required');
}

await initUsageTable();

const modelCache = new Map<string, string>();

// Resolve model + provider-native web search tools.
// - anthropic/*  → webSearch_20250305 tool (executed by Anthropic, max 5 uses)
// - google/*     → googleSearch tool       (executed by Google)
// - openrouter/* → :online suffix on model ID (executed by OpenRouter, no extra tool)
// - other        → no native web search (webFetch tool is still available)
function resolveModel(modelId: string): { model: ReturnType<typeof anthropic>; nativeTools: Record<string, unknown> } {
  if (modelId.startsWith('openrouter:')) {
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const id = modelId.replace('openrouter:', '');
    return { model: openrouter(`${id}:online`) as any, nativeTools: {} };
  }
  if (modelId.startsWith('google/') || modelId.startsWith('gemini')) {
    return {
      model: google(modelId) as any,
      nativeTools: { googleSearch: google.tools.googleSearch({}) },
    };
  }
  return {
    model: anthropic(modelId) as any,
    nativeTools: { webSearch: anthropic.tools.webSearch_20250305({ maxUses: 5 }) },
  };
}

const agentInstructions = await assembleSystemPrompt();
const identitySummary = await getIdentitySummary();
const skills = await loadSkills();
const skillsMetadata = generateSkillsMetadataXml(skills);

const fullInstructions = skillsMetadata
  ? `${agentInstructions}\n\n${skillsMetadata}`
  : agentInstructions;

const storage = createStorage();
const memory = createMemory(storage);
const { model, nativeTools } = resolveModel(AGENT_MODEL);

// Resolve (or create) a thread and return consistent { threadId, resourceId }.
// Cases:
//   1. Both provided  → use as-is
//   2. threadId only  → fetch thread to recover its resourceId
//   3. resourceId only / neither → reuse the most recent thread for that resourceId, or create one
async function resolveMemoryContext(
  threadId: string | undefined,
  resourceId: string | undefined,
): Promise<{ threadId: string; resourceId: string }> {
  if (threadId && resourceId) {
    return { threadId, resourceId };
  }
  if (threadId) {
    const thread = await memory.getThreadById({ threadId });
    return { threadId, resourceId: (thread as any)?.resourceId ?? 'default' };
  }
  const rid = resourceId || 'default';
  const { threads } = await memory.listThreads({ filter: { resourceId: rid } });
  if (threads && threads.length > 0) {
    const latest = threads[threads.length - 1];
    return { threadId: latest.id, resourceId: rid };
  }
  const thread = await memory.createThread({ resourceId: rid });
  return { threadId: thread.id, resourceId: rid };
}

const enabledTools = getEnabledTools();
const mcpTools = (await getMCPTools()) || {};
const tools = { ...enabledTools, ...nativeTools, ...mcpTools };

const mainAgent = new Agent({
  id: 'main',
  name: 'Main Agent',
  instructions: fullInstructions,
  model,
  memory,
  tools,
});

startHeartbeat(mainAgent);

export const mastra = new Mastra({
  agents: { main: mainAgent },
  storage,
  server: {
    port: PORT,
  },
});

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', version }));

app.get('/identity', (c) => {
  return c.json(identitySummary);
});

app.get('/system-prompt', (c) => {
  return c.text(fullInstructions);
});

app.get('/skills', (c) => {
  return c.json({
    skills: skills.map((s) => ({
      id: s.metadata.id,
      name: s.metadata.name,
      description: s.metadata.description,
      available: s.available,
    })),
  });
});

app.get('/api/agents', (c) => {
  const agent = mastra.getAgent('main' as any);
  return c.json({
    agents: [{ id: 'main', name: agent.name }],
  });
});

app.post('/api/agents/:id/generate', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { messages, threadId: rawThreadId, resourceId: rawResourceId } = body;

  const agent = mastra.getAgent(id as any);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const { threadId, resourceId } = await resolveMemoryContext(rawThreadId, rawResourceId);

  const previousModel = modelCache.get(threadId);
  if (previousModel && previousModel !== AGENT_MODEL) {
    console.warn(`[Cache Warning] Model changed mid-session for ${threadId}: ${previousModel} -> ${AGENT_MODEL}. Cache will miss.`);
  }
  modelCache.set(threadId, AGENT_MODEL);

  const dynamicReminders = generateDynamicReminders();
  const lastIdx = messages.length - 1;
  const enhancedMessages = messages.map((msg: { role: string; content: string }, i: number) =>
    i === lastIdx && msg.role === 'user'
      ? { ...msg, content: `${msg.content}\n\n${dynamicReminders}` }
      : msg,
  );

  const result = await agent.generate(enhancedMessages, {
    memory: { thread: threadId, resource: resourceId },
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  });

  const usage = result.usage;
  const cost = usage
    ? calculateCost(AGENT_MODEL, (usage as any).inputTokens ?? 0, (usage as any).outputTokens ?? 0)
    : null;

  if (usage) {
    recordUsage(
      id,
      threadId,
      AGENT_MODEL,
      (usage as any).inputTokens ?? 0,
      (usage as any).outputTokens ?? 0,
      (usage as any).cacheReadTokens ?? 0,
      (usage as any).cacheWriteTokens ?? 0,
    ).catch((err) => console.error('Failed to record usage:', err));
  }

  return c.json({
    text: result.text,
    threadId,
    usage: result.usage,
    cost,
  });
});

app.post('/api/agents/:id/stream', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { messages, threadId: rawThreadId, resourceId: rawResourceId } = body;

  const agent = mastra.getAgent(id as any);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const { threadId, resourceId } = await resolveMemoryContext(rawThreadId, rawResourceId);

  const previousModel = modelCache.get(threadId);
  if (previousModel && previousModel !== AGENT_MODEL) {
    console.warn(`[Cache Warning] Model changed mid-session for ${threadId}: ${previousModel} -> ${AGENT_MODEL}. Cache will miss.`);
  }
  modelCache.set(threadId, AGENT_MODEL);

  const dynamicReminders = generateDynamicReminders();
  const lastIdx = messages.length - 1;
  const enhancedMessages = messages.map((msg: { role: string; content: string }, i: number) =>
    i === lastIdx && msg.role === 'user'
      ? { ...msg, content: `${msg.content}\n\n${dynamicReminders}` }
      : msg,
  );

  const result = await agent.stream(enhancedMessages, {
    memory: { thread: threadId, resource: resourceId },
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  });

  const encoder = new TextEncoder();
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        const usage = result.usage;
        if (usage) {
          promptTokens = (usage as any).inputTokens ?? 0;
          completionTokens = (usage as any).outputTokens ?? 0;
          cacheReadTokens = (usage as any).cacheReadTokens ?? 0;
          cacheWriteTokens = (usage as any).cacheWriteTokens ?? 0;

          recordUsage(
            id,
            threadId,
            AGENT_MODEL,
            promptTokens,
            completionTokens,
            cacheReadTokens,
            cacheWriteTokens,
          ).catch((err) => console.error('Failed to record usage:', err));
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, threadId })}\n\n`));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

app.get('/api/agents/:id/memory/threads', async (c) => {
  const { id } = c.req.param();
  const agent = mastra.getAgent(id as any);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const threads = await memory.listThreads({});
    return c.json({ threads });
  } catch (error) {
    return c.json({ error: 'Failed to list threads', details: String(error) }, 500);
  }
});

app.post('/api/agents/:id/memory/threads', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { resourceId } = body;

  const agent = mastra.getAgent(id as any);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const thread = await memory.createThread({
      resourceId: resourceId || 'default',
    });
    return c.json({ thread });
  } catch (error) {
    return c.json({ error: 'Failed to create thread', details: String(error) }, 500);
  }
});

app.get('/memory/config', (c) => {
  return c.json(memoryConfig);
});

app.get('/api/agents/:id/notifications/stream', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const listener = (notification: Notification) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(notification)}\n\n`));
      };

      notificationEmitter.on('notification', listener);

      // Send a keep-alive comment every 5s to prevent Bun/proxy timeouts
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 5_000);

      c.req.raw.signal.addEventListener('abort', () => {
        notificationEmitter.off('notification', listener);
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

app.get('/api/agents/:id/usage', async (c) => {
  const { id } = c.req.param();

  try {
    const usage = await getAgentUsage(id);
    return c.json(usage);
  } catch (error) {
    return c.json({ error: 'Failed to get usage', details: String(error) }, 500);
  }
});

app.get('/api/agents/:id/usage/threads/:threadId', async (c) => {
  const { id, threadId } = c.req.param();

  try {
    const usage = await getThreadUsage(id, threadId);
    return c.json(usage);
  } catch (error) {
    return c.json({ error: 'Failed to get thread usage', details: String(error) }, 500);
  }
});

const server = new MastraServer({ app, mastra });

export { server };
