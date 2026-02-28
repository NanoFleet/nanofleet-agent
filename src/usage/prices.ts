export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

// IMPROVEMENT: load prices from workspace/prices.json at startup so operators
// can override without recompiling. Fall back to MODEL_PRICES if file absent.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Claude (Anthropic)
  'claude-haiku-4-5': { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-opus-4-6': { inputPerMillion: 5.0, outputPerMillion: 25.0 },

  // Gemini (Google)
  'gemini-3-flash-preview': { inputPerMillion: 0.5, outputPerMillion: 3.0 },

  // OpenRouter
  'minimax/minimax-m2.5': { inputPerMillion: 0.3, outputPerMillion: 1.1 },
};

export function getModelPrice(modelId: string): ModelPrice | null {
  const normalized = modelId.toLowerCase();

  if (MODEL_PRICES[normalized]) {
    return MODEL_PRICES[normalized];
  }

  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (normalized.includes(key)) {
      return price;
    }
  }

  return null;
}

export function calculateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = getModelPrice(modelId);
  if (!price) {
    return null;
  }

  const inputCost = (promptTokens / 1_000_000) * price.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * price.outputPerMillion;

  return inputCost + outputCost;
}
