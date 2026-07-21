import { GoogleGenerativeAI } from '@google/generative-ai';

/** Singleton Gemini client. Returns null when no API key is configured —
 *  the route then answers with `source: 'fallback'` and the client falls
 *  back to the deterministic engine's own re-prompt. */
let cached: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI | null {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return null;
  if (cached) return cached;
  cached = new GoogleGenerativeAI(key);
  return cached;
}

// Fallback chain for the free tier. `thinkingConfig: { thinkingBudget: 0 }`
// is set in the route for 2.5-series models — halves latency for this short
// structured task. ROSTAGENT_MODEL (env) can prepend a different model to the
// chain without a code change.
export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash-lite';
