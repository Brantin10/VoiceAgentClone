import { createAnthropic } from '@ai-sdk/anthropic';

/** Singleton Anthropic provider via the Vercel AI SDK. Returns null when no
 *  API key is configured — the demo then skips straight to the Gemini
 *  fallback, and without any key at all the deterministic engine still runs. */
type AnthropicProvider = ReturnType<typeof createAnthropic>;
let cached: AnthropicProvider | null = null;

export function getAnthropic(): AnthropicProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.length < 10) return null;
  if (cached) return cached;
  cached = createAnthropic({ apiKey: key });
  return cached;
}

/**
 * Cheapest current Claude tier. The turn payload is tiny (short system prompt,
 * a few conversation turns, ~200 output tokens of structured JSON), so the
 * small model is indistinguishable from larger tiers here at a fraction of
 * the cost/latency (~$0.001 per call).
 */
export const CLAUDE_MODEL = 'claude-haiku-4-5';
