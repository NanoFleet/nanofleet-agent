import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// webSearch is intentionally NOT here.
// Web search is handled by provider-native tools injected at the model level:
//   - Anthropic: webSearch_20250305 (via @ai-sdk/anthropic)
//   - Google:    googleSearch       (via @ai-sdk/google)
//   - OpenRouter: :online suffix on model ID
// See src/mastra.ts → resolveModel()

// IMPROVEMENT: replace regex-based HTML stripping with a proper parser
// (e.g. linkedom or node-html-parser) for more reliable extraction,
// especially on malformed HTML or pages with inline > in attributes.
async function fetchUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const html = await response.text();

  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, 50000);
}

export const webFetch = createTool({
  id: 'web-fetch',
  description: 'Fetch and parse a URL, returning readable text with HTML stripped.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch'),
  }),
  execute: async ({ url }) => {
    const content = await fetchUrl(url);
    return { url, content };
  },
});
